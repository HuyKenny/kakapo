// Small HTML helpers shared by listing components (wpautop equivalent, card price logic).
import { formatDate, imgUrl, nightsLabel, partnerLabel, MEAL_LABELS } from '../helpers';
import type { HotelRow } from '../search';

const BLOCK = /^<\/?(p|div|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|section|article|details|summary|figure|hr|pre)\b/i;
/** wpautop for editorial text: blank-line separated chunks become <p> unless they already start with a block tag. */
export function wpautop(html: string): string {
  const src = String(html ?? '').replace(/\r\n?/g, '\n').trim();
  if (src === '') return '';
  return src.split(/\n{2,}/).map((chunk) => {
    const c = chunk.trim();
    if (c === '') return '';
    return BLOCK.test(c) ? c : `<p>${c.replace(/\n/g, '<br />\n')}</p>`;
  }).join('\n');
}

export const ratingStr = (r: number) => r.toFixed(1).replace('.', ',');
export const srcsetRaw = (url: string, w: number, q = 72): string => {
  const one = imgUrl(url, w, q);
  return one === url ? '' : `${one} ${w}w, ${imgUrl(url, w * 2, q)} ${w * 2}w`;
};

export interface CardModel {
  url: string; image: string; stars: number; rating: number | null; partners: number;
  price: number | null; priceOriginal: number | null; discount: number | null; isLm: boolean; drop: number; bestBits: string;
  /** direct exit for the offer shown on the card (null when the card has no concrete offer) */
  cta: { href: string; partner: string } | null;
}
export function cardModel(h: HotelRow, query = ''): CardModel {
  const images = Array.isArray(h.images) ? h.images : [];
  const best = h.best_offer;
  let price: number | null = null; let priceOriginal: number | null = null; let discount: number | null = null;
  if (best) {
    price = Number(best.price_pp);
    if (best.price_original && Number(best.price_original) > price) { priceOriginal = Number(best.price_original); discount = Math.round(100 * (1 - price / priceOriginal)); }
  }
  // no concrete matching offer = no price on the card (the hotel-level minimum may belong to another date or partner)
  const bits = best ? [formatDate(best.departure_date), nightsLabel(Number(best.nights)), MEAL_LABELS[best.meal_type] ?? best.meal_type, ...(best.airport ? ['odlet ' + best.airport] : []), ...(best.transport && best.transport !== 'letecky' && best.transport !== 'neuvedeno' ? [String(best.transport) === 'vlastni' ? 'vlastní doprava' : String(best.transport)] : [])].filter(Boolean).join(' · ') : '';
  return {
    url: `/hotel/${h.slug}/${query}`, image: String(images[0] ?? ''), stars: Math.max(0, Math.min(5, Number(h.stars) || 0)),
    rating: h.rating !== null && h.rating !== undefined && Number(h.rating) > 0 ? Number(h.rating) : null,
    partners: Number(h.partners_count) || 0, price, priceOriginal, discount,
    isLm: best ? !!best.is_last_minute : !!h.has_last_minute,
    drop: 0, bestBits: bits,
    cta: best ? { href: `/go/${Number(best.id)}/?ctx=card`, partner: partnerLabel(String(best.partner_slug ?? '')) } : null,
  };
}
