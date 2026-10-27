// Route resolution and data loading for the product section. The main catch-all page wires these into its routing:
//   const r = await resolveProductRoute(db, pathname); if (r) -> loadHub / loadCategory / loadDetail + components/products/*.
import { todayPrague } from '../search';
import { loadRegistry } from '../snapshots';
import { getTopicStatic, topicSlugList } from '../landing/topics';
import { categoryExists, getCategory, getLanding, typeFromPath, type Landing } from './data';
import { buildDetail, HUB_FAQS, type DetailModel } from './content';
import { categoryMeta, hubFaqLd, hubMeta, productMeta, type PageMeta } from './meta';
import { countsByType, filterOptions, getBySlug, getBySlugAny, search, similar, type FilterOptions, type ProductRow, type ProductSearch } from './repo';

export type ProductRoute =
  | { kind: 'hub' }
  | { kind: 'category'; type: string; path: string }
  | { kind: 'landing'; slug: string; type: string; path: string; landing: Landing }
  | { kind: 'product'; slug: string; product: ProductRow }
  | { kind: 'redirect'; status: 302; location: string }
  | { kind: 'notfound' };

export interface ResolveOptions {
  /** PHP templates/product.php intends 302 to the category for vanished products, but the router 404s first. Default = live behaviour (404). */
  redirectGone?: boolean;
}

/**
 * Maps a pathname to a product-section route, or null if the path does not belong to this section
 * (so the caller can try hotel landings etc.). /zazitek/{slug} that is unknown/inactive/hidden → notfound (404, noindex).
 */
export async function resolveProductRoute(db: D1Database, pathname: string, opts: ResolveOptions = {}): Promise<ProductRoute | null> {
  const segs = pathname.split('?')[0]!.split('/').filter(Boolean);
  if (segs.length === 1) {
    const s = segs[0]!;
    if (s === 'objevte') return { kind: 'hub' };
    const landing = getLanding(s);
    if (landing) return { kind: 'landing', slug: s, type: landing.type, path: landing.path, landing };
    const type = typeFromPath(s);
    if (type !== '') return { kind: 'category', type, path: s };
    return null;
  }
  if (segs.length === 2 && segs[0] === 'zazitek') {
    let slug = segs[1]!;
    try { slug = decodeURIComponent(slug); } catch { return { kind: 'notfound' }; }
    if (!/^[a-z0-9-]{1,191}$/.test(slug)) return { kind: 'notfound' };
    const p = await getBySlug(db, slug);
    if (p) return { kind: 'product', slug, product: p };
    if (opts.redirectGone) {
      const gone = await getBySlugAny(db, slug);
      if (gone && !gone.hidden && categoryExists(gone.type)) return { kind: 'redirect', status: 302, location: `/${getCategory(gone.type).path}/` };
    }
    return { kind: 'notfound' };
  }
  return null;
}

/* ---------------------------------------------------------------- hub */
export interface HubData { counts: Record<string, { cnt: number; min_price: number }>; total: number; moreTopics: Array<{ label: string; path: string }>; airportLinks: Array<{ label: string; path: string }>; faqs: typeof HUB_FAQS; meta: PageMeta; extraJsonLd: unknown[] }
export async function loadHub(db: D1Database, site: string): Promise<HubData> {
  const [counts, top] = await Promise.all([countsByType(db), search(db, { per_page: 12, sort: 'price' })]);
  const total = Object.values(counts).reduce((a, c) => a + c.cnt, 0);
  // every hand-written selection and departure-airport page is linked from here (they were orphans: nothing else points at them)
  const reg = await loadRegistry(db);
  const moreTopics = topicSlugList().map((s) => getTopicStatic(s)).filter((t): t is NonNullable<typeof t> => !!t && !!t.path && !!t.label).map((t) => ({ label: t.label, path: t.path }));
  const airportLinks = Object.values(reg.airports).filter((a) => a.cnt >= 10).sort((x, y) => y.cnt - x.cnt).slice(0, 30).map((a) => ({ label: 'Dovolená z letiště ' + a.label, path: `/odlet-z-${a.slug}/` }));
  return { counts, total, moreTopics, airportLinks, faqs: HUB_FAQS, meta: hubMeta(site, top.products), extraJsonLd: [hubFaqLd(HUB_FAQS)] };
}

/* ---------------------------------------------------------------- category / landing */
export const CENA_BANDS: Record<string, { label: string; min: number; max: number }> = {
  '0-3000': { label: 'do 3 000 Kč', min: 0, max: 3000 },
  '3000-8000': { label: '3 000–8 000 Kč', min: 3000, max: 8000 },
  '8000-20000': { label: '8 000–20 000 Kč', min: 8000, max: 20000 },
  '20000': { label: 'nad 20 000 Kč', min: 20000, max: 0 },
};
const sanitizeKey = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
const sanitizeText = (s: unknown) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/[\r\n\t ]+/g, ' ').trim();

export interface CategoryView {
  type: string; cat: ReturnType<typeof getCategory> & { label: string; path: string; intro: string };
  landing: Landing | null; base: string;
  sort: string; zeme: string; partner: string; q: string; cena: string; lok: string; typ: string; page: number;
  hasFilters: boolean; res: ProductSearch; opts: FilterOptions; summary: Array<{ label: string; value: string }>;
  /** current (non-default) params, to build filter links */
  cur: Record<string, string>;
  meta: PageMeta;
}

const countWord = (n: number, one: string, few: string, many: string) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
const num = (n: number) => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export async function loadCategory(
  db: D1Database, site: string, route: { type: string; landing?: Landing | null }, params: URLSearchParams,
): Promise<CategoryView> {
  const type = route.type; const landing = route.landing ?? null;
  const baseCat = getCategory(type);
  const cat = landing
    ? { ...baseCat, label: landing.label ?? baseCat.label, path: landing.path ?? baseCat.path, intro: landing.intro ?? baseCat.intro, seo_text: landing.seo_text ?? baseCat.seo_text ?? '', faqs: landing.faqs ?? baseCat.faqs ?? [] }
    : { ...baseCat };
  const locked = (landing?.filters ?? {}) as Record<string, string | number>;
  const g = (k: string) => params.get(k) ?? '';

  const sort = sanitizeKey(locked.sort ?? (g('sort') || 'price'));
  const zeme = sanitizeKey(locked.country ?? g('zeme'));
  const partner = sanitizeKey(locked.partner ?? g('partner'));
  const q = sanitizeText(locked.q ?? g('q'));
  const cena = sanitizeKey(g('cena'));
  const lok = sanitizeText(locked.place ?? g('lokalita'));
  const typ = sanitizeText(locked.kind ?? g('typ'));
  const page = Math.max(1, parseInt(g('strana'), 10) || 1);

  const band = CENA_BANDS[cena];
  let priceMin = band ? band.min : 0; let priceMax = band ? band.max : 0;
  if (locked.price_min) priceMin = Math.trunc(Number(locked.price_min));
  if (locked.price_max) priceMax = Math.trunc(Number(locked.price_max));

  const [res, opts] = await Promise.all([
    search(db, { type, country: zeme, partner, place: lok, kind: typ, q, price_min: priceMin, price_max: priceMax, sort, page, per_page: 24 }),
    filterOptions(db, type),
  ]);
  const hasFilters = !!(zeme || partner || g('q') || cena || lok || typ);

  const rows = type === 'wellness' ? opts.places : opts.countries;
  const places = rows.slice(0, 3).map((r: any) => String(type === 'wellness' ? r.place : r.country).trim()).filter(Boolean);
  const summary: Array<{ label: string; value: string }> = [{ label: 'Aktuálně v nabídce', value: `${num(res.total)} ${countWord(res.total, 'nabídka', 'nabídky', 'nabídek')}` }];
  if (opts.price.min) summary.push({ label: 'Cena od', value: `${num(opts.price.min)} Kč` });
  if (places.length) summary.push({ label: type === 'wellness' ? 'Časté lokality' : 'Nejčastější země', value: places.join(', ') });
  if (opts.partners.length > 0) summary.push({ label: 'Prověření partneři', value: `${opts.partners.length} ${countWord(opts.partners.length, 'partner', 'partneři', 'partnerů')}` });

  const cur: Record<string, string> = {};
  const set = (k: string, v: string) => { if (v !== '') cur[k] = v; };
  set('zeme', zeme); set('partner', partner); set('q', g('q') ? q : ''); set('lokalita', lok); set('typ', typ); set('cena', cena); set('sort', sort !== 'price' ? sort : '');

  // SEO meta (the PHP meta() decides indexability from its own param list + a per_page=1 search with landing filters)
  const metaParamsFiltered = ['sort', 'strana', 'zeme', 'partner', 'q', 'cena', 'lokalita', 'typ'].some((k) => g(k) !== '');
  const metaTotal = (await search(db, { type, per_page: 1, ...(landing?.filters ?? {}) } as any)).total;
  const top12 = (await search(db, { type, per_page: 12, sort: 'price', ...(landing?.filters ?? {}) } as any)).products;
  const meta = categoryMeta(site, { type, landing, total: metaTotal, filtered: metaParamsFiltered, top12 });
  return { type, cat, landing, base: `/${cat.path}/`, sort, zeme, partner, q, cena, lok, typ, page, hasFilters, res, opts, summary, cur, meta };
}

/** URL on the category base with overridden params (empty value drops the param), like the PHP closure $kakapo_url. */
export function categoryUrl(base: string, cur: Record<string, string>, override: Record<string, string | number>): string {
  const merged: Record<string, string> = { ...cur };
  for (const [k, v] of Object.entries(override)) merged[k] = String(v);
  const qs = Object.entries(merged).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return qs ? `${base}?${qs}` : base;
}

/* ---------------------------------------------------------------- detail */
export interface DetailData { detail: DetailModel; similar: ProductRow[]; meta: PageMeta }
export async function loadDetail(db: D1Database, site: string, product: ProductRow, today = todayPrague()): Promise<DetailData> {
  const detail = buildDetail(product, today);
  const sim = await similar(db, product, 4);
  return { detail, similar: sim, meta: productMeta(site, product, detail.faqs, today) };
}
