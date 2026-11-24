// Static listing data for the frozen site (scripts/static): /data/zajezdy/index.json + one shard per country.
// Rendered at build time over the local D1 copy (src/pages/data/zajezdy/[file].json.ts) and crawled into static files;
// src/lib/listing/engine.ts filters, sorts and renders it in the browser (Workers static assets ignore query strings,
// so /zajezdy/?country=…&meal=… can no longer be answered by SSR).
//
// Shard (compact on purpose, ~9 k hotels / ~30 k offers in total):
//   { v, slug, base: 'YYYY-MM-DD', s: string table,
//     h: [[id, slug, name, destSlug#, dest#, citySlug#, stars, rating|null, image, partners, offersActive, minPrice|null,
//          dropPct, bits, mealFlags, country#, offers: [[day, nights, meal#, airportSlug#, airport#, transport#, partner#, price, orig, flags, adults], …]], …] }
//   # = index into `s`; day = days after `base`; offers of a hotel are sorted by price, then id (first match = cheapest, like bestOffers()).
import { staleFeedIds, sellableSql } from '../offers/eligibility';
import { themeConditionSql, todayPrague } from '../search';

export const DATA_VERSION = 1;
/** Shard name of hotels without a country (they only show on listings without a country filter). */
export const NO_COUNTRY = '_';
export const shardName = (countrySlug: string): string => (countrySlug === '' ? NO_COUNTRY : countrySlug);
export const SHARD_RE = /^(?:_|[a-z0-9][a-z0-9-]{0,60})$/;

/** Hotel `bits` (keep in sync with engine.ts). */
export const BIT = { img: 1, lm: 2, fm: 4, sea: 8, children: 16, aquapark: 32, sandy: 64 } as const;
const THEMES: Array<[string, number]> = [['sea', BIT.sea], ['children', BIT.children], ['aquapark', BIT.aquapark], ['sandy-beach', BIT.sandy]];

export interface DataIndex { v: number; today: string; stale: boolean; shards: Array<[string, number]> }

export async function buildIndex(db: D1Database, today = todayPrague()): Promise<DataIndex> {
  const rows = (await db.prepare(
    `SELECT country_slug AS c, COUNT(*) AS n FROM hotels WHERE offers_active > 0 AND hidden = 0 GROUP BY country_slug ORDER BY n DESC, country_slug`,
  ).all<{ c: string; n: number }>()).results;
  const stale = await staleFeedIds(db);
  return { v: DATA_VERSION, today, stale: stale.length > 0, shards: rows.map((r) => [shardName(r.c), Number(r.n)]) };
}

const dayDiff = (a: string, b: string): number => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);

export async function buildShard(db: D1Database, shard: string, today = todayPrague()): Promise<Record<string, unknown> | null> {
  if (!SHARD_RE.test(shard)) return null;
  const country = shard === NO_COUNTRY ? '' : shard;
  const hotels = (await db.prepare(
    `SELECT id, slug, name, country, destination, destination_slug, city_slug, stars, rating, images_json, partners_count, offers_active,
            min_price, price_drop_pct, has_last_minute, has_first_minute, meal_flags
       FROM hotels h WHERE h.offers_active > 0 AND h.hidden = 0 AND h.country_slug = ? ORDER BY h.id`,
  ).bind(country).all<any>()).results;
  if (!hotels.length) return null;

  const themed = new Map<number, number>();
  for (const [theme, bit] of THEMES) {
    const [sql, params] = themeConditionSql(theme);
    if (!sql) continue;
    const ids = (await db.prepare(`SELECT h.id FROM hotels h WHERE h.offers_active > 0 AND h.hidden = 0 AND h.country_slug = ? AND ${sql}`).bind(country, ...params).all<{ id: number }>()).results;
    for (const r of ids) themed.set(r.id, (themed.get(r.id) ?? 0) | bit);
  }

  const stale = await staleFeedIds(db);
  const offers = (await db.prepare(
    `SELECT o.hotel_id, o.departure_date, o.nights, o.meal_type, o.airport_slug, o.airport, o.transport, o.partner_slug, o.price_pp, o.price_original,
            o.is_last_minute, o.is_first_minute, o.adults
       FROM offers o JOIN hotels h ON h.id = o.hotel_id
      WHERE h.offers_active > 0 AND h.hidden = 0 AND h.country_slug = ? AND ${sellableSql(stale, today).join(' AND ')}
      ORDER BY o.hotel_id, o.price_pp, o.id`,
  ).bind(country).all<any>()).results;

  const strings: string[] = []; const pos = new Map<string, number>();
  const s = (v: unknown): number => { const k = String(v ?? ''); let i = pos.get(k); if (i === undefined) { i = strings.length; strings.push(k); pos.set(k, i); } return i; };
  const byHotel = new Map<number, unknown[][]>();
  for (const o of offers) {
    const flags = (o.is_last_minute ? 1 : 0) | (o.is_first_minute ? 2 : 0);
    const orig = o.price_original && Number(o.price_original) > 0 ? Number(o.price_original) : 0;
    let list = byHotel.get(o.hotel_id); if (!list) byHotel.set(o.hotel_id, (list = []));
    list.push([dayDiff(today, o.departure_date), Number(o.nights), s(o.meal_type), s(o.airport_slug), s(o.airport), s(o.transport), s(o.partner_slug), Number(o.price_pp), orig, flags, Number(o.adults)]);
  }
  const h = hotels.map((r) => {
    let images: unknown = [];
    try { images = JSON.parse(r.images_json || '[]'); } catch { images = []; }
    const img = Array.isArray(images) ? String(images[0] ?? '') : '';
    const hasImg = r.images_json !== null && r.images_json !== '' && r.images_json !== '[]';
    const bits = (hasImg ? BIT.img : 0) | (r.has_last_minute ? BIT.lm : 0) | (r.has_first_minute ? BIT.fm : 0) | (themed.get(r.id) ?? 0);
    return [Number(r.id), r.slug, r.name, s(r.destination_slug), s(r.destination), s(r.city_slug), Number(r.stars) || 0, r.rating === null ? null : Number(r.rating), img,
      Number(r.partners_count) || 0, Number(r.offers_active) || 0, r.min_price === null ? null : Number(r.min_price), Number(r.price_drop_pct) || 0, bits, Number(r.meal_flags) || 0, s(r.country),
      byHotel.get(r.id) ?? []];
  });
  return { v: DATA_VERSION, slug: country, base: today, s: strings, h };
}
