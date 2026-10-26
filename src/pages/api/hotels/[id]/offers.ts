// GET /api/hotels/{id}/offers?sort=price|departure|nights|discount&month=YYYY-MM
// Same JSON shape as the WordPress REST endpoint /kakapo/v1/hotels/{id}/offers (consumed by Alpine kakapoOffers in frontend.js).
import type { APIRoute } from 'astro';
import { getEnv } from '../../../../lib/server/env';
import { nowPrague, offersForHotel, toOfferView } from '../../../../lib/hotel';

export const prerender = false;

const SORTS = new Set(['price', 'departure', 'nights', 'discount']);

export const GET: APIRoute = async ({ params, url }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad_id' }, 400);
  const sortParam = (url.searchParams.get('sort') ?? 'price').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const sort = SORTS.has(sortParam) ? sortParam : 'price';
  const m = url.searchParams.get('month') ?? '';
  const month = /^\d{4}-\d{2}$/.test(m) ? m : '';
  const now = nowPrague();
  const rows = await offersForHotel(getEnv().DB, id, sort, month, now.slice(0, 10));
  const offers = rows.map((o) => {
    const v = toOfferView(o, now);
    return {
      id: v.id, partner: v.partner_slug, partner_slug: v.partner_slug, price_pp: v.price_pp, price_original: v.price_original,
      discount: v.price_original ? v.discount : null, real_drop: v.real_drop || null, prev_price: v.prev_price,
      departure_date: v.departure_date, return_date: v.return_date, nights: v.nights, meal_type: v.meal_type, meal_label: v.meal_label,
      airport: v.airport, room_type: v.room_type, availability: v.availability, is_last_minute: v.is_last_minute, go_url: v.go_url,
    };
  });
  return json({ offers }, 200, 'public, max-age=60, s-maxage=300');
};

function json(body: unknown, status = 200, cache = 'no-store'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache } });
}
