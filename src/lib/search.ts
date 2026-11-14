// Port of Kakapo_Search_Engine: filters normalisation, SQL builder over hotels/offers, similar hotels.
// Hotel-level filters hit `hotels` (indexed), offer-level filters go through EXISTS.
import { jsonArr, slugify } from './helpers';
import { THEME_BITS } from './themes';
import { sellableSql, staleFeedIds } from './offers/eligibility';

// per-isolate cache of stale feed ids (refreshed by the async entry points below)
let staleNow: number[] = [];
async function prime(db: D1Database): Promise<void> { staleNow = await staleFeedIds(db); }

export interface Filters {
  country?: string; country_exclude?: string[]; dest?: string; city?: string; q?: string; theme?: string;
  stars?: number[]; meal?: string[]; airport?: string[]; partner?: string[];
  price_min?: number; price_max?: number; nights_min?: number; nights_max?: number; rating_min?: number;
  date_from?: string; date_to?: string; transport?: string; flag?: string; adults?: number;
  sort: string; page: number;
}
export const PER_PAGE = 24;
export const DROP_MIN_PCT = 5; // Kakapo_Price_History::DROP_MIN_PCT — verify against the plugin before launch
const SORTS = ['recommended', 'price', 'price-desc', 'departure', 'discount', 'rating', 'drop'];

const list = (v: unknown): string[] => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean);
const slugs = (v: unknown) => [...new Set(list(v).map(slugify).filter(Boolean))].sort();

/** Canonical filter shape (also used as cache key). */
export function normalizeFilters(input: Record<string, unknown>): Filters {
  const f: Filters = { sort: 'recommended', page: 1 };
  for (const k of ['country', 'dest', 'city'] as const) if (input[k]) f[k] = slugify(String(input[k]));
  const ce = slugs(input.country_exclude); if (ce.length) f.country_exclude = ce;
  if (['sea', 'children', 'aquapark', 'sandy-beach'].includes(String(input.theme))) f.theme = String(input.theme);
  if (input.q) f.q = String(input.q).trim().slice(0, 100);
  const st = [...new Set(list(input.stars).map((x) => parseInt(x, 10)).filter((x) => x > 0))].sort((a, b) => a - b); if (st.length) f.stars = st;
  for (const k of ['meal', 'airport', 'partner'] as const) { const v = slugs(input[k]); if (v.length) f[k] = v; }
  for (const k of ['price_min', 'price_max', 'nights_min', 'nights_max'] as const) { const n = parseInt(String(input[k] ?? ''), 10); if (n > 0) f[k] = n; }
  if (input.rating_min) f.rating_min = Math.min(10, Math.max(0, parseFloat(String(input.rating_min)) || 0));
  for (const k of ['date_from', 'date_to'] as const) if (/^\d{4}-\d{2}-\d{2}$/.test(String(input[k] ?? ''))) f[k] = String(input[k]);
  if (['letecky', 'autobusem', 'vlastni'].includes(String(input.transport))) f.transport = String(input.transport);
  if (['last-minute', 'first-minute', 'zlevneno'].includes(String(input.flag))) f.flag = String(input.flag);
  if (input.adults) f.adults = Math.min(10, Math.max(1, parseInt(String(input.adults), 10) || 1));
  f.sort = SORTS.includes(String(input.sort)) ? String(input.sort) : 'recommended';
  f.page = Math.max(1, parseInt(String(input.page ?? '1'), 10) || 1);
  return f;
}

const SEA_COUNTRIES = ['recko', 'turecko', 'egypt', 'spanelsko', 'bulharsko', 'chorvatsko', 'italie', 'tunisko', 'kypr', 'portugalsko', 'kanarske-ostrovy', 'spojene-arabske-emiraty', 'maledivy', 'dominikanska-republika', 'mauricius', 'kapverdy', 'kapverdske-ostrovy', 'mexiko', 'thajsko', 'albanie', 'cerna-hora', 'tanzanie', 'oman', 'kena', 'seychely', 'malta', 'vietnam', 'maroko', 'kostarika', 'indonesie', 'sri-lanka', 'jamajka', 'madeira', 'kuba', 'sardinie', 'mallorca', 'menorca', 'djerba', 'tenerife', 'dubaj',
  'zanzibar', 'barbados', 'aruba', 'katar', 'bahrajn', 'malajsie', 'panama', 'gambie', 'brazilie'];
/** Seaside countries: 'u moře' landings exist only for these (others redirect to the country page). */
export const isSeaCountry = (slug: string): boolean => SEA_COUNTRIES.includes(slug);
const FAMILY_COUNTRIES = ['recko', 'turecko', 'egypt', 'spanelsko', 'bulharsko', 'chorvatsko', 'italie', 'tunisko', 'kypr', 'kanarske-ostrovy', 'cesko', 'slovensko', 'rakousko'];
const like = (kw: string) => '%' + kw.replace(/[\\%_]/g, '\\$&') + '%';

type Sql = [string, unknown[]];
/** SQL string literal for CODE-OWNED constants only (never user input): D1 allows max 100 bound parameters per statement. */
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
const qs = (n: number) => Array(n).fill('?').join(',');

/** Interní tematické filtry (sea/children/aquapark/sandy-beach). Keyword themes use hotels.theme_flags (see themes.ts). */
export function themeConditionSql(theme: string, alias = 'h'): Sql {
  if (theme === 'sea') return [`(${alias}.country_slug IN (${SEA_COUNTRIES.map(lit).join(',')}))`, []];
  if (theme === 'children') return [`(${alias}.country_slug IN (${FAMILY_COUNTRIES.map(lit).join(',')}) AND (${alias}.has_all_inclusive = 1 OR (${alias}.theme_flags & ${THEME_BITS.children}) != 0))`, []];
  if (theme === 'aquapark' || theme === 'sandy-beach') return [`((${alias}.theme_flags & ${THEME_BITS[theme]}) != 0)`, []];
  return ['', []];
}

function buildConditions(f: Filters): { where: string[]; params: unknown[]; oc: string[]; op: unknown[] } {
  const where: string[] = []; const params: unknown[] = []; const oc: string[] = []; const op: unknown[] = [];
  if (f.country) { where.push('h.country_slug = ?'); params.push(f.country); }
  if (f.country_exclude?.length) { where.push(`h.country_slug NOT IN (${qs(f.country_exclude.length)})`); params.push(...f.country_exclude); }
  if (f.dest) { where.push('(h.destination_slug = ? OR h.city_slug = ?)'); params.push(f.dest, f.dest); }
  if (f.city) { where.push('h.city_slug = ?'); params.push(f.city); }
  if (f.q) { where.push("h.name LIKE ? ESCAPE '\\'"); params.push(like(f.q)); }
  if (f.stars?.length) where.push(`h.stars IN (${f.stars.map((s) => Math.trunc(s)).join(',')})`);
  if (f.rating_min) { where.push('h.rating >= ?'); params.push(f.rating_min); }
  if (f.price_min) { where.push('h.min_price >= ?'); params.push(f.price_min); }
  if (f.price_max) { where.push('h.min_price <= ?'); params.push(f.price_max); }
  if (f.flag) {
    if (f.flag === 'zlevneno') where.push(`h.price_drop_pct >= ${DROP_MIN_PCT}`);
    else { where.push(f.flag === 'last-minute' ? 'h.has_last_minute = 1' : 'h.has_first_minute = 1'); oc.push(f.flag === 'last-minute' ? 'o.is_last_minute = 1' : 'o.is_first_minute = 1'); }
  }
  if (f.theme) { const [s, p] = themeConditionSql(f.theme); if (s) { where.push(s); params.push(...p); } }
  if (f.meal?.length) { oc.push(`o.meal_type IN (${qs(f.meal.length)})`); op.push(...f.meal); }
  if (f.airport?.length) { oc.push(`o.airport_slug IN (${qs(f.airport.length)})`); op.push(...f.airport); }
  if (f.transport) { oc.push('o.transport = ?'); op.push(f.transport); }
  if (f.partner?.length) { oc.push(`o.partner_slug IN (${qs(f.partner.length)})`); op.push(...f.partner); }
  if (f.date_from) { oc.push('o.departure_date >= ?'); op.push(f.date_from); }
  if (f.date_to) { oc.push('o.departure_date <= ?'); op.push(f.date_to); }
  if (f.nights_min) { oc.push('o.nights >= ?'); op.push(f.nights_min); }
  if (f.nights_max) { oc.push('o.nights <= ?'); op.push(f.nights_max); }
  if (f.adults) { oc.push('o.adults >= ?'); op.push(f.adults); }
  // sellable offers only: a listed hotel must have a bookable offer that matches every condition (future departure, fresh feed)
  if (oc.length || staleNow.length) oc.push(...sellableSql(staleNow).slice(1));
  if (oc.length && f.price_max) { oc.push('o.price_pp <= ?'); op.push(f.price_max); }
  if (oc.length && f.price_min) { oc.push('o.price_pp >= ?'); op.push(f.price_min); }
  return { where, params, oc, op };
}

function orderClause(sort: string): string {
  switch (sort) {
    case 'recommended': return "(h.images_json IS NOT NULL AND h.images_json <> '' AND h.images_json <> '[]') DESC, (h.stars > 0) DESC, h.rating IS NULL, h.rating DESC, h.offers_active DESC, h.min_price ASC";
    case 'price-desc': return 'h.min_price DESC';
    case 'rating': return 'h.rating IS NULL, h.rating DESC, h.min_price ASC';
    case 'discount': return 'h.has_last_minute DESC, h.min_price ASC';
    case 'drop': return 'h.price_drop_pct DESC, h.min_price ASC';
    default: return 'h.min_price ASC';
  }
}

export interface HotelRow { [k: string]: any; id: number; slug: string; name: string; images: string[]; best_offer: any | null }
export interface SearchResult { hotels: HotelRow[]; total: number; pages: number; page: number }

export const todayPrague = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date());

export async function search(db: D1Database, filters: Filters, today = todayPrague()): Promise<SearchResult> {
  await prime(db);
  const f = filters;
  const { where, params, oc, op } = buildConditions(f);
  const exists = oc.length ? ` AND EXISTS (SELECT 1 FROM offers o INDEXED BY idx_offers_hotel WHERE o.hotel_id = h.id AND o.active = 1 AND ${oc.join(' AND ')})` : '';
  const whereSql = (where.length ? ' AND ' + where.join(' AND ') : '');
  const base = `FROM hotels h WHERE h.offers_active > 0 AND h.hidden = 0${whereSql}${exists}`;
  const all = [...params, ...op];
  const total = (await db.prepare(`SELECT COUNT(*) AS n ${base}`).bind(...all).first<{ n: number }>())?.n ?? 0;
  const offset = (f.page - 1) * PER_PAGE;
  const rows = (await db.prepare(`SELECT h.* ${base} ORDER BY ${orderClause(f.sort)} LIMIT ? OFFSET ?`).bind(...all, PER_PAGE, offset).all<any>()).results;
  const best = await bestOffers(db, rows.map((r) => r.id), oc, op, today);
  const hotels: HotelRow[] = rows.map((r) => ({ ...r, images: jsonArr<string>(r.images_json), best_offer: best.get(r.id) ?? null }));
  return { hotels, total, pages: Math.ceil(total / PER_PAGE), page: f.page };
}

/** Cheapest matching offer per hotel (card price must respect offer-level filters). */
async function bestOffers(db: D1Database, ids: number[], oc: string[], op: unknown[], today: string): Promise<Map<number, any>> {
  const out = new Map<number, any>();
  if (!ids.length) return out;
  const idList = ids.map((i) => Math.trunc(i)).join(',');
  const cond = oc.length ? ' AND ' + oc.join(' AND ') : '';
  const rows = (await db.prepare(
    `SELECT o.* FROM offers o INNER JOIN (SELECT hotel_id, MIN(price_pp) AS mp FROM offers o WHERE o.active = 1 AND o.departure_date >= ? AND o.hotel_id IN (${idList})${cond} GROUP BY hotel_id) m
     ON m.hotel_id = o.hotel_id AND m.mp = o.price_pp WHERE o.active = 1 AND o.hotel_id IN (${idList})${cond} GROUP BY o.hotel_id`,
  ).bind(today, ...op, ...op).all<any>()).results;
  for (const r of rows) out.set(r.hotel_id, r);
  return out;
}

const GOOD = "(length(description) >= ? OR (images_json IS NOT NULL AND images_json <> '' AND images_json <> '[]' AND images_json NOT LIKE '[\"\"%'))";

export async function sameDestination(db: D1Database, hotel: any, minDesc: number, limit = 18): Promise<Array<{ slug: string; name: string; min_price: number | null }>> {
  const scope = hotel.destination_slug ? 'destination_slug' : 'country_slug';
  const value = hotel.destination_slug || hotel.country_slug;
  if (!value) return [];
  return (await db.prepare(`SELECT slug, name, min_price FROM hotels WHERE offers_active > 0 AND hidden = 0 AND id != ? AND ${scope} = ? AND ${GOOD} ORDER BY offers_active DESC, id ASC LIMIT ?`).bind(hotel.id, value, minDesc, limit).all<any>()).results;
}

export async function similar(db: D1Database, hotel: any, minDesc: number, limit = 4): Promise<HotelRow[]> {
  const pool = Math.max(12, limit * 5);
  let rows = (await db.prepare(
    `SELECT * FROM hotels WHERE offers_active > 0 AND hidden = 0 AND id != ? AND (destination_slug = ? OR country_slug = ?) AND ${GOOD}
     ORDER BY (destination_slug = ?) DESC, ABS(COALESCE(min_price,0) - ?) ASC LIMIT ?`,
  ).bind(hotel.id, hotel.destination_slug, hotel.country_slug, minDesc, hotel.destination_slug, hotel.min_price ?? 0, pool).all<any>()).results;
  if (rows.length > limit) { const o = hotel.id % rows.length; rows = [...rows.slice(o), ...rows.slice(0, o)].slice(0, limit); }
  return rows.map((r) => ({ ...r, images: jsonArr<string>(r.images_json), best_offer: null }));
}

/** Prepared COUNT statement (use with db.batch: many counts in ONE D1 round trip). */
export function countStatement(db: D1Database, f: Filters): D1PreparedStatement {
  const { where, params, oc, op } = buildConditions(f);
  const exists = oc.length ? ` AND EXISTS (SELECT 1 FROM offers o INDEXED BY idx_offers_hotel WHERE o.hotel_id = h.id AND o.active = 1 AND ${oc.join(' AND ')})` : '';
  const sql = `SELECT COUNT(*) AS n FROM hotels h WHERE h.offers_active > 0 AND h.hidden = 0${where.length ? ' AND ' + where.join(' AND ') : ''}${exists}`;
  return db.prepare(sql).bind(...params, ...op);
}
/** Count only (no card data, no best offers) — used by sitemap/noindex decisions. */
export async function countHotels(db: D1Database, f: Filters): Promise<number> {
  await prime(db);
  return (await countStatement(db, f).first<{ n: number }>())?.n ?? 0;
}
/** Many counts in as few round trips as possible (D1 batch, chunks of 40). */
export async function countMany(db: D1Database, filters: Filters[]): Promise<number[]> {
  await prime(db);
  const out: number[] = [];
  for (let i = 0; i < filters.length; i += 40) {
    const res = await db.batch(filters.slice(i, i + 40).map((f) => countStatement(db, f)));
    for (const r of res) out.push(Number((r.results as Array<{ n: number }>)[0]?.n ?? 0));
  }
  return out;
}
