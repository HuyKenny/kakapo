// Registry + global facet snapshots. Imported by BOTH the web Worker and the import Worker, so it only
// depends on a D1 handle (no Astro / cloudflare:workers imports).
import { MEAL_BITS, MEAL_LABELS, partnerLabel } from './helpers';

export interface RegEntry { label: string; cnt: number; min_price: number }
export interface Registry {
  countries: Record<string, RegEntry>;
  destinations: Record<string, Record<string, RegEntry>>;
  airports: Record<string, { slug: string; label: string; cnt: number }>;
  partners: Record<string, { slug: string; label: string; cnt: number }>;
  built_at: string;
}
export interface FacetSnapshot {
  countries: Array<{ slug: string; label: string; cnt: number; min_price: number }>;
  stars: Array<{ value: number; cnt: number }>;
  meals: Array<{ slug: string; label: string; cnt: number }>;
  airports: Array<{ slug: string; label: string; cnt: number }>;
  partners: Array<{ slug: string; label: string; cnt: number }>;
  nights: Array<{ value: number; cnt: number }>;
}

const all = async <T>(db: D1Database, sql: string, ...p: unknown[]): Promise<T[]> => (await db.prepare(sql).bind(...p).all<T>()).results;

/** Recompute registry + facets from the catalogue and store them in site_cache. */
export async function rebuildSnapshots(db: D1Database, now = new Date().toISOString()): Promise<{ registry: Registry; facets: FacetSnapshot }> {
  const registry: Registry = { countries: {}, destinations: {}, airports: {}, partners: {}, built_at: now };
  for (const r of await all<any>(db, "SELECT country_slug AS slug, country AS label, COUNT(*) AS cnt, MIN(min_price) AS min_price FROM hotels WHERE offers_active > 0 AND hidden = 0 AND country_slug != '' GROUP BY country_slug, country ORDER BY cnt DESC"))
    registry.countries[r.slug] = { label: r.label, cnt: r.cnt, min_price: r.min_price ?? 0 };
  for (const r of await all<any>(db, "SELECT country_slug, destination_slug AS slug, destination AS label, COUNT(*) AS cnt, MIN(min_price) AS min_price FROM hotels WHERE offers_active > 0 AND hidden = 0 AND destination_slug != '' GROUP BY country_slug, destination_slug, destination ORDER BY cnt DESC LIMIT 3000")) {
    (registry.destinations[r.country_slug] ??= {})[r.slug] = { label: r.label, cnt: r.cnt, min_price: r.min_price ?? 0 };
  }
  for (const r of await all<any>(db, "SELECT airport_slug AS slug, airport AS label, COUNT(*) AS cnt FROM offers WHERE active = 1 AND airport_slug != '' GROUP BY airport_slug, airport ORDER BY cnt DESC LIMIT 30"))
    registry.airports[r.slug] = { slug: r.slug, label: r.label, cnt: r.cnt };
  for (const r of await all<any>(db, 'SELECT partner_slug AS slug, COUNT(*) AS cnt FROM offers WHERE active = 1 GROUP BY partner_slug ORDER BY cnt DESC'))
    registry.partners[r.slug] = { slug: r.slug, label: partnerLabel(r.slug), cnt: r.cnt };

  const facets: FacetSnapshot = {
    countries: Object.entries(registry.countries).map(([slug, c]) => ({ slug, label: c.label, cnt: c.cnt, min_price: c.min_price })),
    stars: await all(db, 'SELECT stars AS value, COUNT(*) AS cnt FROM hotels WHERE offers_active > 0 AND hidden = 0 AND stars > 0 GROUP BY stars ORDER BY stars DESC'),
    meals: [],
    airports: Object.values(registry.airports),
    partners: Object.values(registry.partners),
    nights: await all(db, 'SELECT nights AS value, COUNT(*) AS cnt FROM offers WHERE active = 1 GROUP BY nights ORDER BY nights ASC LIMIT 20'),
  };
  for (const [slug, bit] of Object.entries(MEAL_BITS)) {
    const row = await db.prepare(`SELECT COUNT(*) AS cnt FROM hotels WHERE offers_active > 0 AND hidden = 0 AND (meal_flags & ${bit}) != 0`).first<{ cnt: number }>();
    if (row?.cnt) facets.meals.push({ slug, label: MEAL_LABELS[slug]!, cnt: row.cnt });
  }
  await db.batch([
    db.prepare('INSERT INTO site_cache (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').bind('registry', JSON.stringify(registry), now),
    db.prepare('INSERT INTO site_cache (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').bind('facets', JSON.stringify(facets), now),
    // bumps every edge-cache key (middleware): a price change is visible right after the import
    db.prepare('INSERT INTO site_cache (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').bind('data_version', now, now),
  ]);
  return { registry, facets };
}

let memo: { at: number; r: Registry } | null = null;
let facetMemo: { at: number; f: FacetSnapshot } | null = null;
const MEMO_MS = 60_000;

export async function loadRegistry(db: D1Database): Promise<Registry> {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.r;
  const row = await db.prepare("SELECT value FROM site_cache WHERE key='registry'").first<{ value: string }>();
  const r: Registry = row ? JSON.parse(row.value) : (await rebuildSnapshots(db)).registry;
  memo = { at: Date.now(), r };
  return r;
}
export async function loadFacets(db: D1Database): Promise<FacetSnapshot> {
  if (facetMemo && Date.now() - facetMemo.at < MEMO_MS) return facetMemo.f;
  const row = await db.prepare("SELECT value FROM site_cache WHERE key='facets'").first<{ value: string }>();
  const f: FacetSnapshot = row ? JSON.parse(row.value) : (await rebuildSnapshots(db)).facets;
  facetMemo = { at: Date.now(), f };
  return f;
}
export const isCountry = (r: Registry, slug: string) => !!r.countries[slug];
export const isDestination = (r: Registry, c: string, d: string) => !!r.destinations[c]?.[d];
export const isAirport = (r: Registry, slug: string) => !!r.airports[slug];
export const countryLabel = (r: Registry, slug: string) => r.countries[slug]?.label ?? slug.charAt(0).toUpperCase() + slug.slice(1);
export const destinationLabel = (r: Registry, c: string, d: string) => r.destinations[c]?.[d]?.label ?? d.charAt(0).toUpperCase() + d.slice(1);
export const airportLabel = (r: Registry, slug: string) => r.airports[slug]?.label ?? slug.charAt(0).toUpperCase() + slug.slice(1);
