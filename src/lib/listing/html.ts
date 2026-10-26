// Small HTML helpers shared by listing components (wpautop equivalent, card price logic).
import { formatDate, imgUrl, nightsLabel, MEAL_LABELS } from '../helpers';
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
  return one === url ? '' : `${one} 1x, ${imgUrl(url, w * 2, q)} 2x`;
};

export interface CardModel {
  url: string; image: string; stars: number; rating: number | null; partners: number;
  price: number | null; priceOriginal: number | null; discount: number | null; isLm: boolean; drop: number; bestBits: string;
}
export function cardModel(h: HotelRow): CardModel {
  const images = Array.isArray(h.images) ? h.images : [];
  const best = h.best_offer;
  let price: number | null = null; let priceOriginal: number | null = null; let discount: number | null = null;
  if (best) {
    price = Number(best.price_pp);
    if (best.price_original && Number(best.price_original) > price) { priceOriginal = Number(best.price_original); discount = Math.round(100 * (1 - price / priceOriginal)); }
  } else if (h.min_price !== null && h.min_price !== undefined) price = Number(h.min_price);
  const bits = best ? [formatDate(best.departure_date), nightsLabel(Number(best.nights)), MEAL_LABELS[best.meal_type] ?? best.meal_type, ...(best.airport ? ['odlet ' + best.airport] : [])].filter(Boolean).join(' · ') : '';
  return {
    url: `/hotel/${h.slug}/`, image: String(images[0] ?? ''), stars: Math.max(0, Math.min(5, Number(h.stars) || 0)),
    rating: h.rating !== null && h.rating !== undefined && Number(h.rating) > 0 ? Number(h.rating) : null,
    partners: Number(h.partners_count) || 0, price, priceOriginal, discount,
    isLm: best ? !!best.is_last_minute : !!h.has_last_minute,
    drop: Number(h.price_drop_pct ?? 0), bestBits: bits,
  };
}
