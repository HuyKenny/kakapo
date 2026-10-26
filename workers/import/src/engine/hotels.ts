// Hotel identity, enrichment rules and denormalised aggregates (port of Kakapo_Hotel_Repository).
// Identity = GIATA id, then manual alias, then dedup key. No fuzzy matching: a false merge is worse than a duplicate.
import type { Db, D1Stmt } from '../deps';
import type { NormHotel } from '../model';
import { hotelDedupKey, slugify, MEAL_BITS } from '../util/text';
import { chunk, parseJson, selectIn, runBatches, MAX_PARAMS, qs } from './db';

const sanitizeKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9_\-]/g, '');

const DESC_SCORE: Record<string, number> = { kakapo: 1000, cedok: 110, fischer: 100, tui: 100, 'blue-style': 100, bluestyle: 100, 'exim-tours': 100, eximtours: 100, exim: 100, invia: 80, slevomat: 55, 'dovolena-cz': 20, dovolena: 20 };
const descScore = (src: string) => DESC_SCORE[sanitizeKey(src)] ?? 50;
const IMG_SCORE: Record<string, number> = { cedok: 90, fischer: 70, tui: 70, 'blue-style': 70, bluestyle: 70, 'exim-tours': 70, eximtours: 70, exim: 70, slevomat: 40, invia: 30, 'dovolena-cz': 30, dovolena: 30 };
const imgScore = (src: string) => IMG_SCORE[sanitizeKey(src)] ?? 50;

export function shouldReplaceDescription(cur: string, curSrc: string, next: string, nextSrc: string): boolean {
  cur = cur.trim(); next = next.trim();
  if (next === '') return false;
  if (cur === '') return true;
  const cs = descScore(curSrc), ns = descScore(nextSrc);
  if (ns > cs) return [...next].length >= 80 || [...next].length >= [...cur].length;
  if (ns < cs) return false;
  return [...next].length > [...cur].length + 50;
}
export function shouldReplaceImages(cur: string[], curSrc: string, next: string[], nextSrc: string): boolean {
  const n = next.filter(Boolean);
  if (n.length < 3) return false;
  if (!cur.length) return true;
  return imgScore(nextSrc) > imgScore(curSrc);
}
export function dedupeImageUrls(urls: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const u of urls) {
    if (!u) continue;
    let key = u; try { key = new URL(u).pathname; } catch { /* keep raw */ }
    if (seen.has(key)) continue;
    seen.add(key); out.push(u);
  }
  return out;
}

export interface HotelRow {
  stars: number; rating: number | null; rating_count: number; lat: number | null; lng: number | null; giata_id: number | null;
  description: string; description_source: string; images_json: string | null; images_source: string; amenities_json: string | null;
}
export type HotelPatch = Partial<HotelRow>;

/** What a feed may add to an existing hotel: only missing or poorer data is filled, richer data is never overwritten. */
export function enrichPatch(row: HotelRow, h: NormHotel, partner: string): HotelPatch {
  const p: HotelPatch = {};
  if (!row.giata_id && h.giata_id) p.giata_id = h.giata_id;
  if (!row.stars && h.stars) p.stars = Math.min(5, Math.max(0, h.stars));
  if (row.rating === null && h.rating !== null) { p.rating = h.rating; p.rating_count = h.rating_count; }
  if (row.lat === null && h.lat) { p.lat = h.lat; p.lng = h.lng || null; }
  if (shouldReplaceDescription(row.description ?? '', row.description_source ?? '', h.description, partner)) { p.description = h.description; p.description_source = sanitizeKey(partner); }
  const cur = parseJson<string[]>(row.images_json, []);
  let merged: string[];
  if (shouldReplaceImages(cur, row.images_source ?? '', h.images, partner)) { merged = dedupeImageUrls([...h.images, ...cur]).slice(0, 15); p.images_source = sanitizeKey(partner); }
  else merged = dedupeImageUrls([...cur, ...h.images]).slice(0, 15);
  if (JSON.stringify(merged) !== JSON.stringify(cur)) p.images_json = JSON.stringify(merged);
  if (h.amenities.length > parseJson<string[]>(row.amenities_json, []).length) p.amenities_json = JSON.stringify(h.amenities);
  return p;
}
const applyPatch = (row: HotelRow, p: HotelPatch): HotelRow => ({ ...row, ...p } as HotelRow);

const EMPTY_ROW: HotelRow = { stars: 0, rating: null, rating_count: 0, lat: null, lng: null, giata_id: null, description: '', description_source: '', images_json: '[]', images_source: '', amenities_json: '[]' };

export interface UpsertResult { ids: number[]; created: number; enriched: number }

/** Resolve or create the hotel of every item. `ids[i]` is 0 when the hotel could not be stored. */
export async function upsertHotels(db: Db, items: NormHotel[], partner: string, nowSql: string): Promise<UpsertResult> {
  const keys = items.map((h) => hotelDedupKey(h.country, h.city, h.destination, h.name, h.lat, h.lng));
  const giatas = [...new Set(items.map((h) => h.giata_id).filter((g): g is number => !!g))];
  const byGiata = new Map<number, number>();
  for (const r of await selectIn<{ id: number; giata_id: number }>(db, 'SELECT id, giata_id FROM hotels WHERE giata_id IN ({IN}) ORDER BY id DESC', giatas)) byGiata.set(r.giata_id, r.id);
  const uniq = [...new Set(keys)];
  const alias = new Map<string, number>();
  for (const r of await selectIn<{ alias_key: string; hotel_id: number }>(db, 'SELECT alias_key, hotel_id FROM hotel_aliases WHERE alias_key IN ({IN})', uniq)) alias.set(r.alias_key, r.hotel_id);
  const byKey = new Map<string, number>();
  for (const r of await selectIn<{ id: number; dedup_key: string }>(db, 'SELECT id, dedup_key FROM hotels WHERE dedup_key IN ({IN})', uniq)) byKey.set(r.dedup_key, r.id);

  // resolve each item to an existing id, or to a pending (new) hotel keyed by dedup key
  const existing: Array<{ i: number; id: number }> = [];
  const pending = new Map<string, { first: number; items: number[] }>();
  const pendingByGiata = new Map<number, string>();
  const ids = new Array<number>(items.length).fill(0);
  items.forEach((h, i) => {
    const key = keys[i]!;
    let id = (h.giata_id && byGiata.get(h.giata_id)) || alias.get(key) || byKey.get(key) || 0;
    if (id) { existing.push({ i, id }); return; }
    let pk = h.giata_id ? pendingByGiata.get(h.giata_id) : undefined;
    pk = pk ?? (pending.has(key) ? key : undefined);
    if (pk) { pending.get(pk)!.items.push(i); return; }
    pending.set(key, { first: i, items: [i] });
    if (h.giata_id) pendingByGiata.set(h.giata_id, key);
  });

  const stmts: D1Stmt[] = [];
  let enriched = 0;
  // enrichment of existing hotels (several items may hit one hotel; patches compose in order)
  const exIds = [...new Set(existing.map((e) => e.id))];
  const rows = new Map<number, HotelRow>();
  for (const r of await selectIn<HotelRow & { id: number }>(db, 'SELECT id, stars, rating, rating_count, lat, lng, giata_id, description, description_source, images_json, images_source, amenities_json FROM hotels WHERE id IN ({IN})', exIds)) rows.set(r.id, r);
  const dirty = new Map<number, HotelPatch>();
  for (const { i, id } of existing) {
    ids[i] = id;
    const row = rows.get(id); if (!row) { ids[i] = 0; continue; }
    const p = enrichPatch(row, items[i]!, partner);
    if (Object.keys(p).length) { rows.set(id, applyPatch(row, p)); dirty.set(id, { ...(dirty.get(id) ?? {}), ...p }); }
  }
  for (const [id, p] of dirty) {
    const cols = Object.keys(p);
    stmts.push(db.prepare(`UPDATE hotels SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).bind(...cols.map((c) => (p as Record<string, unknown>)[c] ?? null), nowSql, id));
    enriched++;
  }

  // new hotels: unique slug, enrichment of repeated items applied before the insert
  const newKeys = [...pending.keys()];
  const slugBase = new Map<string, string>();
  for (const k of newKeys) {
    const h = items[pending.get(k)!.first]!;
    slugBase.set(k, (slugify(`${h.name} ${h.city !== '' ? h.city : h.destination}`) || 'hotel').slice(0, 180));
  }
  const taken = new Set<string>();
  for (const r of await selectIn<{ slug: string }>(db, 'SELECT slug FROM hotels WHERE slug IN ({IN})', [...slugBase.values()])) taken.add(r.slug);
  const used = new Set<string>(taken);
  for (const k of newKeys) {
    const { first, items: idx } = pending.get(k)!;
    const h = items[first]!;
    let row: HotelRow = { ...EMPTY_ROW, description: h.description, description_source: sanitizeKey(partner), images_json: JSON.stringify(dedupeImageUrls(h.images)), images_source: sanitizeKey(partner), amenities_json: JSON.stringify(h.amenities), giata_id: h.giata_id, stars: h.stars, rating: h.rating, rating_count: h.rating_count, lat: h.lat, lng: h.lng };
    for (const j of idx.slice(1)) row = applyPatch(row, enrichPatch(row, items[j]!, partner));
    let slug = slugBase.get(k)!, n = 1;
    while (used.has(slug)) { n++; slug = `${slugBase.get(k)!.slice(0, 176)}-${n}`; }
    used.add(slug);
    stmts.push(db.prepare(`INSERT OR IGNORE INTO hotels (slug,dedup_key,giata_id,name,country,country_slug,destination,destination_slug,city,city_slug,stars,rating,rating_count,lat,lng,description,description_source,images_json,images_source,amenities_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(slug, k, row.giata_id, h.name, h.country, slugify(h.country), h.destination, slugify(h.destination), h.city, slugify(h.city),
      Math.min(5, row.stars), row.rating, row.rating_count, row.lat, row.lng, row.description, row.description_source, row.images_json, row.images_source, row.amenities_json, nowSql, nowSql));
  }
  await runBatches(db, stmts);
  let created = 0;
  if (newKeys.length) {
    const got = new Map<string, number>();
    for (const r of await selectIn<{ id: number; dedup_key: string }>(db, 'SELECT id, dedup_key FROM hotels WHERE dedup_key IN ({IN})', newKeys)) got.set(r.dedup_key, r.id);
    for (const k of newKeys) { const id = got.get(k) ?? 0; for (const i of pending.get(k)!.items) ids[i] = id; if (id) created++; }
  }
  return { ids, created, enriched };
}

export interface AggregateOpts { today: string; nowSql: string }
interface OfferAgg { hotel_id: number; price_pp: number; partner_slug: string; is_last_minute: number; is_first_minute: number; meal_type: string; airport_slug: string }

/** Recompute the denormalised columns of the given hotels from active offers; writes only hotels whose values changed. */
export async function recomputeAggregates(db: Db, hotelIds: number[], o: AggregateOpts): Promise<{ checked: number; written: number }> {
  let written = 0;
  for (const ids of chunk([...new Set(hotelIds)], MAX_PARAMS)) {
    const offers = (await db.prepare(`SELECT hotel_id, price_pp, partner_slug, is_last_minute, is_first_minute, meal_type, airport_slug FROM offers WHERE active = 1 AND hotel_id IN (${qs(ids.length)})`).bind(...ids).all<OfferAgg>()).results;
    const agg = new Map<number, { min: number; cnt: number; partners: Set<string>; lm: number; fm: number; ai: number; meals: Set<string>; airports: Set<string> }>();
    for (const r of offers) {
      let a = agg.get(r.hotel_id);
      if (!a) agg.set(r.hotel_id, (a = { min: Infinity, cnt: 0, partners: new Set(), lm: 0, fm: 0, ai: 0, meals: new Set(), airports: new Set() }));
      a.min = Math.min(a.min, r.price_pp); a.cnt++; a.partners.add(r.partner_slug);
      a.lm = Math.max(a.lm, r.is_last_minute); a.fm = Math.max(a.fm, r.is_first_minute);
      if (r.meal_type === 'all-inclusive') a.ai = 1;
      a.meals.add(r.meal_type); if (r.airport_slug) a.airports.add(r.airport_slug);
    }
    const cur = (await db.prepare(`SELECT id, min_price, offers_active, partners_count, has_last_minute, has_first_minute, has_all_inclusive, meal_flags, airports_csv, offers_last_seen FROM hotels WHERE id IN (${qs(ids.length)})`).bind(...ids).all<Record<string, unknown>>()).results;
    const stmts: D1Stmt[] = [];
    for (const h of cur) {
      const a = agg.get(h.id as number);
      const want = a
        ? { min_price: a.min, offers_active: a.cnt, partners_count: a.partners.size, has_last_minute: a.lm, has_first_minute: a.fm, has_all_inclusive: a.ai,
            meal_flags: [...a.meals].reduce((s, m) => s | (MEAL_BITS[m] ?? 0), 0), airports_csv: [...a.airports].sort().join(',').slice(0, 255) }
        : { min_price: null, offers_active: 0, partners_count: 0, has_last_minute: 0, has_first_minute: 0, has_all_inclusive: 0, meal_flags: 0, airports_csv: '' };
      const changed = (Object.keys(want) as Array<keyof typeof want>).some((k) => (h[k] ?? null) !== want[k]);
      // "last time we saw a live offer" feeds the indexing grace period; refresh it at most once per day, not on every import
      const stale = a && (!h.offers_last_seen || String(h.offers_last_seen).slice(0, 10) < o.today);
      if (!changed && !stale) continue;
      stmts.push(db.prepare(`UPDATE hotels SET min_price=?, offers_active=?, partners_count=?, has_last_minute=?, has_first_minute=?, has_all_inclusive=?, meal_flags=?, airports_csv=?,
        offers_last_seen = CASE WHEN ? > 0 THEN ? ELSE offers_last_seen END WHERE id = ?`).bind(want.min_price, want.offers_active, want.partners_count, want.has_last_minute, want.has_first_minute, want.has_all_inclusive, want.meal_flags, want.airports_csv, want.offers_active, o.nowSql, h.id));
    }
    written += await runBatches(db, stmts);
  }
  return { checked: hotelIds.length, written };
}
