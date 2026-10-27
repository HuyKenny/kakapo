// Sitemap URL collection (port of Kakapo_Seo::collect_sitemap_urls). Heavy (counts per landing), so it is
// materialised into site_cache by rebuildSitemaps() (import Worker after each run + daily) and only read at request time.
import { countHotels, normalizeFilters } from './search';
import { loadRegistry } from './snapshots';
import { MEAL_LANDINGS, longtailSitemapLandings, canonicalAliasTarget, getTopicStatic, topicPaths } from './landing';
import { productRepo, LANDINGS as PRODUCT_LANDINGS, CATEGORIES as PRODUCT_CATEGORIES } from './products';
import { HOTEL_MIN_DESC, HOTEL_GRACE_DAYS } from './hotel';

export interface SitemapUrl { loc: string; mod: string; cf: 'daily' | 'weekly' | 'monthly' }
const LANDING_TEXTS_REVISED = '2026-10-26'; // titles/headings switched to the season year // manual: bump only when landing texts are really rewritten (see PHP comment)
const LEGAL = ['ochrana-osobnich-udaju', 'podminky-pouziti', 'kontakt'];
const PER_FILE = 1000;
const day = (v?: string | null, fb = '') => (v ? String(v).slice(0, 10) : fb);
const maxDate = (...d: string[]) => d.filter(Boolean).sort().pop() ?? '';

export async function collectSitemapUrls(db: D1Database, base: string, now = new Date()): Promise<SitemapUrl[]> {
  const today = now.toISOString().slice(0, 10);
  const one = async (sql: string, ...p: unknown[]) => (await db.prepare(sql).bind(...p).all<any>()).results;
  const hotelMod = day((await db.prepare('SELECT MAX(updated_at) AS m FROM hotels').first<{ m: string }>())?.m, today);
  const productMod = day((await db.prepare('SELECT MAX(updated_at) AS m FROM products').first<{ m: string }>())?.m, today);
  const staticMod = LANDING_TEXTS_REVISED;
  const urls: SitemapUrl[] = [{ loc: `${base}/`, mod: maxDate(staticMod, hotelMod, productMod), cf: 'daily' }];
  for (const s of LEGAL) urls.push({ loc: `${base}/${s}/`, mod: staticMod, cf: 'monthly' });

  for (const path of topicPaths()) {
    const t = getTopicStatic(path.replace(/^\/|\/$/g, ''));
    let mod = staticMod;
    if (t?.listing) {
      const n = await countHotels(db, normalizeFilters((t.filters ?? {}) as Record<string, unknown>));
      if (n < Math.max(1, t.index_min ?? 1)) continue;
      mod = hotelMod;
    }
    urls.push({ loc: base + path, mod, cf: 'monthly' });
  }

  // landing pages: lastmod per country/destination (two GROUP BYs), not one global date
  const geo = new Map<string, string>();
  for (const r of await one("SELECT country_slug AS k, MAX(updated_at) AS m FROM hotels WHERE offers_active > 0 AND country_slug <> '' GROUP BY country_slug")) geo.set(r.k, day(r.m));
  for (const r of await one("SELECT country_slug || '/' || destination_slug AS k, MAX(updated_at) AS m FROM hotels WHERE offers_active > 0 AND country_slug <> '' AND destination_slug <> '' GROUP BY country_slug, destination_slug")) geo.set(r.k, day(r.m));
  const reg = await loadRegistry(db);
  const landings: Array<{ path: string; cnt?: number }> = [{ path: '/zajezdy/' }, { path: '/last-minute/' }, { path: '/first-minute/' }, ...MEAL_LANDINGS.map((m) => ({ path: `/${m}/` }))];
  for (const [slug, c] of Object.entries(reg.countries)) landings.push({ path: `/${slug}/`, cnt: c.cnt });
  for (const [cs, ds] of Object.entries(reg.destinations)) for (const [ds2, d] of Object.entries(ds)) landings.push({ path: `/${cs}/${ds2}/`, cnt: d.cnt });
  for (const a of Object.keys(reg.airports)) landings.push({ path: `/odlet-z-${a}/`, cnt: reg.airports[a]!.cnt });
  landings.push(...(await longtailSitemapLandings(db)));
  const seen = new Set(urls.map((u) => u.loc));
  for (const l of landings) {
    if (l.cnt === 0 || canonicalAliasTarget(l.path) !== '') continue;
    const seg = l.path.split('/').filter(Boolean);
    const mod = geo.get(seg.slice(0, 2).join('/')) ?? geo.get(seg[0] ?? '') ?? hotelMod;
    const loc = base + l.path;
    if (!seen.has(loc)) { seen.add(loc); urls.push({ loc, mod, cf: 'daily' }); }
  }

  // product hub, categories and landings (non-empty only)
  const counts = await productRepo.countsByType(db);
  if (Object.keys(counts).length) {
    const pm = maxDate(staticMod, productMod);
    urls.push({ loc: `${base}/objevte/`, mod: pm, cf: 'daily' });
    for (const [type, c] of Object.entries(PRODUCT_CATEGORIES as Record<string, { path: string }>)) if (counts[type]?.cnt) urls.push({ loc: `${base}/${c.path}/`, mod: pm, cf: 'daily' });
    for (const [plSlug, pl] of Object.entries(PRODUCT_LANDINGS as Record<string, any>)) {
      const res = await productRepo.search(db, { type: pl.type ?? '', per_page: 1, ...(pl.filters ?? {}) } as any);
      if (res.total >= Math.max(1, pl.index_min ?? 1)) urls.push({ loc: `${base}/${plSlug}/`, mod: pm, cf: 'daily' });
    }
  }

  // hotels: (description >= min OR >= 1 photo) AND (active offer OR last offer within grace) — mirrors hotel_is_indexable
  const grace = new Date(now.getTime() - HOTEL_GRACE_DAYS * 864e5).toISOString().slice(0, 19).replace('T', ' ');
  for (const r of await one(
    `SELECT slug, updated_at FROM hotels WHERE hidden = 0 AND retired_at IS NULL AND (offers_active > 0 OR offers_last_seen >= ?)
       AND (length(description) >= ? OR (images_json IS NOT NULL AND images_json <> '' AND images_json <> '[]' AND images_json NOT LIKE '[""%'))
     ORDER BY offers_active DESC, id ASC LIMIT 40000`, grace, HOTEL_MIN_DESC))
    urls.push({ loc: `${base}/hotel/${r.slug}/`, mod: day(r.updated_at, today), cf: 'daily' });
  for (const r of await one("SELECT slug, updated_at FROM products WHERE active = 1 AND hidden = 0 ORDER BY updated_at DESC, id ASC LIMIT 5000"))
    urls.push({ loc: `${base}/zazitek/${r.slug}/`, mod: day(r.updated_at, today), cf: 'weekly' });
  return urls;
}

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const urlsetXml = (urls: SitemapUrl[]) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${xmlEsc(u.loc)}</loc><changefreq>${u.cf}</changefreq><lastmod>${u.mod}</lastmod></url>`).join('\n')}\n</urlset>`;
const indexXml = (base: string, files: Array<{ n: number; mod: string }>) => `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${files.map((f) => `\t<sitemap>\n\t\t<loc>${base}/kakapo-sitemap${f.n}.xml</loc>\n\t\t<lastmod>${f.mod}T00:00:00+00:00</lastmod>\n\t</sitemap>`).join('\n')}\n</sitemapindex>`;

const put = (db: D1Database, key: string, value: string, now: string) => db.prepare('INSERT INTO site_cache (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').bind(key, value, now);

/** Materialise index + files (1000 URLs each, same URL scheme as Rank Math used) + the single fallback file. */
export async function rebuildSitemaps(db: D1Database, base: string): Promise<{ urls: number; files: number }> {
  const urls = await collectSitemapUrls(db, base);
  const now = new Date().toISOString();
  const files: Array<{ n: number; mod: string }> = [];
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0, n = 1; i < urls.length; i += PER_FILE, n++) {
    const chunk = urls.slice(i, i + PER_FILE);
    stmts.push(put(db, `sitemap:${n}`, urlsetXml(chunk), now));
    files.push({ n, mod: chunk.reduce((m, u) => (u.mod > m ? u.mod : m), '') });
  }
  stmts.push(put(db, 'sitemap:index', indexXml(base, files), now), put(db, 'sitemap:all', urlsetXml(urls), now), put(db, 'sitemap:files', String(files.length), now));
  for (let i = 0; i < stmts.length; i += 20) await db.batch(stmts.slice(i, i + 20));
  return { urls: urls.length, files: files.length };
}
