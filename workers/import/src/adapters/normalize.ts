// Raw adapter output -> validated model. Business rules from Kakapo_Offer_Repository / Product_Repository live here,
// so every adapter (XML, CJ, Čedok) goes through the same gate and rejections are reported, never silently dropped.
import { NormHotel, NormOffer, NormProduct, Term, type Rejection } from '../model';
import { addDays, isYmd, normalizeMeal, slugify } from '../util/text';
import { categorize, typeExists } from './categories';

type R = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => s(x)).filter((x) => x !== '') : s(v) !== '' ? [s(v)] : []);

/** Deeplink + feed affiliate params (query string or `{url}` template). Never re-encodes a finished tracking link. */
export function buildAffiliateUrl(deeplink: string, params: string): string {
  const d = deeplink.trim();
  if (d === '' || !/^https?:\/\//i.test(d)) return '';
  const p = params.trim();
  if (p === '') return d;
  if (p.includes('{url}')) return p.replace('{url}', encodeURIComponent(d));
  return d + (d.includes('?') ? '&' : '?') + p.replace(/^[?&]+/, '');
}

export interface NormCtx { today: string; affiliateParams: string; lastMinuteDays?: number; firstMinuteDays?: number }

export type NormOutcome<T> = { ok: true; value: T } | { ok: false; rej: Rejection };

export function normalizeHotel(raw: R): NormalizedHotelResult {
  const parsed = NormHotel.safeParse({
    name: s(raw.name), country: s(raw.country), destination: s(raw.destination), city: s(raw.city),
    giata_id: n(raw.giata_id) > 0 ? Math.trunc(n(raw.giata_id)) : null,
    stars: Math.min(5, Math.max(0, Math.trunc(n(raw.stars)))),
    rating: raw.rating === null || raw.rating === undefined || raw.rating === '' ? null : Math.min(10, Math.max(0, n(raw.rating))),
    rating_count: Math.max(0, Math.trunc(n(raw.rating_count))),
    lat: n(raw.lat) ? n(raw.lat) : null, lng: n(raw.lng) ? n(raw.lng) : null,
    description: s(raw.description), images: arr(raw.images), amenities: arr(raw.amenities),
  });
  return parsed.success ? { ok: true, hotel: parsed.data } : { ok: false, reason: 'hotel: ' + parsed.error.issues.map((i) => i.path.join('.')).join(',') };
}
export type NormalizedHotelResult = { ok: true; hotel: NormHotel } | { ok: false; reason: string };

export function normalizeOffer(raw: R, ctx: NormCtx): NormOutcome<NormOffer> {
  const external_id = s(raw.external_id);
  const price = Math.round(n(raw.price_pp));
  const dep = s(raw.departure_date);
  if (external_id === '') return { ok: false, rej: { external_id: null, reason: 'offer: missing external_id' } };
  if (price <= 0) return { ok: false, rej: { external_id, reason: 'offer: price <= 0' } };
  if (!isYmd(dep)) return { ok: false, rej: { external_id, reason: 'offer: bad departure_date' } };
  if (dep < ctx.today) return { ok: false, rej: { external_id, reason: 'past_departure' } };
  const url = buildAffiliateUrl(s(raw.affiliate_url), ctx.affiliateParams);
  if (url === '') return { ok: false, rej: { external_id, reason: 'offer: bad affiliate_url' } };
  const nights = Math.max(1, Math.trunc(n(raw.nights)) || 7);
  const ret = isYmd(s(raw.return_date)) ? s(raw.return_date) : addDays(dep, nights);
  let original = Math.round(n(raw.price_original));
  if (original <= price) original = 0;
  const parsed = NormOffer.safeParse({
    external_id, title: s(raw.title), price_pp: price,
    price_total: Math.round(n(raw.price_total)) > 0 ? Math.round(n(raw.price_total)) : null,
    price_original: original > 0 ? original : null,
    currency: s(raw.currency) || 'CZK', departure_date: dep, return_date: ret, nights,
    meal_type: normalizeMeal(raw.meal_type), transport: s(raw.transport) || 'letecky',
    airport: s(raw.airport), arrival_airport: s(raw.arrival_airport), room_type: s(raw.room_type),
    adults: Math.max(1, Math.trunc(n(raw.adults)) || 2), children: Math.max(0, Math.trunc(n(raw.children))),
    availability: s(raw.availability) || 'available', affiliate_url: url, image_url: s(raw.image_url) || null,
  });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, rej: { external_id, reason: 'offer: ' + parsed.error.issues.map((i) => i.path.join('.')).join(',') } };
}

export interface ProductOpts { defaultType: string; forceType: string; signalsExtra?: string[] }

export function normalizeProduct(raw: R, ctx: NormCtx, opts: ProductOpts): NormOutcome<NormProduct> {
  const title = s(raw.title);
  const price = Math.round(n(raw.price));
  const country = s(raw.country);
  const ext = slugify(`${title} ${country}`).slice(0, 180) || s(raw.external_id);
  if (ext === '' || title === '' || price <= 0) return { ok: false, rej: { external_id: ext || null, reason: 'product: missing title/price' } };
  const url = buildAffiliateUrl(s(raw.affiliate_url), ctx.affiliateParams);
  if (url === '') return { ok: false, rej: { external_id: ext, reason: 'product: bad affiliate_url' } };

  const cats = arr(raw._categories);
  const signals = [s(raw._tour_type), ...cats, title, s(raw.description), s(raw.destination), s(raw.place), country].filter((x) => x !== '');
  const type = opts.forceType !== '' && typeExists(opts.forceType) ? opts.forceType : categorize(signals, opts.defaultType);
  const type_raw = cats.length ? cats.slice(0, 3).join(' | ') : s(raw._tour_type);

  const terms: Term[] = [];
  const rawTerms = Array.isArray(raw.terms) ? (raw.terms as R[]) : [];
  if (rawTerms.length) {
    for (const t of rawTerms) {
      const from = s(t.from);
      if (!isYmd(from) || from < ctx.today) continue;
      const tp = Math.round(n(t.price)) || price;
      const u = s(t.url) !== '' ? buildAffiliateUrl(s(t.url), ctx.affiliateParams) : '';
      terms.push({ from, to: isYmd(s(t.to)) ? s(t.to) : null, nights: Math.max(0, Math.trunc(n(t.nights))), price: tp, url: u || url });
    }
  } else if (isYmd(s(raw.date_from)) && s(raw.date_from) >= ctx.today) {
    terms.push({ from: s(raw.date_from), to: isYmd(s(raw.date_to)) ? s(raw.date_to) : null, nights: Math.trunc(n(raw.nights)), price, url });
  }

  const parsed = NormProduct.safeParse({
    external_id: ext, title, description: s(raw.description), price, currency: s(raw.currency) || 'CZK', country,
    destination: s(raw.destination), place: s(raw.place), images: arr(raw.images).concat(s(raw.image_url) ? [s(raw.image_url)] : []),
    nights: n(raw.nights) > 0 ? Math.trunc(n(raw.nights)) : null,
    date_from: isYmd(s(raw.date_from)) ? s(raw.date_from) : null, date_to: isYmd(s(raw.date_to)) ? s(raw.date_to) : null,
    meal: s(raw.meal), transport: s(raw.transport), affiliate_url: url, type, type_raw: type_raw.slice(0, 100), terms,
  });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, rej: { external_id: ext, reason: 'product: ' + parsed.error.issues.map((i) => i.path.join('.')).join(',') } };
}

/** Variants of one tour (same title+country) merge into one product with dated terms (run-aware, like the WP importer). */
export function mergeProducts(a: NormProduct, b: NormProduct): NormProduct {
  const by = new Map<string, Term>();
  for (const t of [...a.terms, ...b.terms]) {
    const k = `${t.from}|${t.nights}`;
    const cur = by.get(k);
    if (!cur || t.price < cur.price) by.set(k, t);
  }
  const terms = [...by.values()].sort((x, y) => x.from.localeCompare(y.from)).slice(0, 60);
  const minPrice = terms.length ? Math.min(...terms.map((t) => t.price)) : Math.min(a.price, b.price);
  return {
    ...a,
    description: a.description.length >= b.description.length ? a.description : b.description,
    images: [...new Set([...a.images, ...b.images])].slice(0, 15),
    terms, price: minPrice, date_from: terms[0]?.from ?? a.date_from ?? b.date_from,
  };
}
export function finalizeProduct(p: NormProduct): NormProduct {
  if (p.terms.length === 0) return p;
  const terms = [...p.terms].sort((x, y) => x.from.localeCompare(y.from)).slice(0, 60);
  return { ...p, terms, price: Math.min(...terms.map((t) => t.price)), date_from: terms[0]!.from };
}
export { normalizeMeal };
