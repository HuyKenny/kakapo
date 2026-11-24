// Client-side listing engine for the static site: the same filters, order, card price and facet counts as the SSR
// search (src/lib/search.ts search()/bestOffers()/orderClause(), src/lib/listing/facets.ts), evaluated over the
// static shards from src/lib/listing/static-data.ts. Pure functions — used in the browser (client.ts) and in tests.
import { countryFlagHtml, formatDate, formatPrice, imgUrl, MEAL_BITS, MEAL_LABELS, nightsLabel } from '../helpers';
import { DROP_MIN_PCT, normalizeFilters, PER_PAGE, type Filters } from '../search';
import { selectionQuery } from '../hotel/selection';
import { srcsetRaw } from './html';

/** GET params a listing accepts (GET wins over the landing's own filters, see mergeFilters in ./index.ts). */
export const GET_KEYS = ['country', 'dest', 'q', 'meal', 'stars', 'airport', 'partner', 'price_min', 'price_max', 'rating_min', 'date_from', 'date_to', 'nights_min', 'nights_max', 'adults', 'flag', 'theme', 'transport', 'sort'];

/** Hotel bits — same values as BIT in ./static-data.ts (not imported: that module is server-only). */
const B = { img: 1, lm: 2, fm: 4, sea: 8, children: 16, aquapark: 32, sandy: 64 } as const;
const THEME_BIT: Record<string, number> = { sea: B.sea, children: B.children, aquapark: B.aquapark, 'sandy-beach': B.sandy };

export interface Offer { dep: string; nights: number; meal: string; airport_slug: string; airport: string; transport: string; partner: string; price: number; orig: number; lm: boolean; fm: boolean; adults: number }
export interface Hotel {
  id: number; slug: string; name: string; country: string; country_slug: string; destination: string; destination_slug: string; city_slug: string;
  stars: number; rating: number | null; image: string; partners_count: number; offers_active: number; min_price: number | null; price_drop_pct: number;
  bits: number; meal_flags: number; offers: Offer[]; text: string;
}
export interface DataIndex { v: number; today: string; stale: boolean; shards: Array<[string, number]> }

/** Lower-case without diacritics: "Kréta" → "kreta". */
export const fold = (s: string): string => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const addDays = (ymd: string, n: number): string => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

export function decodeShard(raw: any): Hotel[] {
  const s: string[] = raw.s ?? []; const base = String(raw.base); const slug = String(raw.slug ?? '');
  const dates = new Map<number, string>();
  const date = (d: number) => { let v = dates.get(d); if (v === undefined) { v = addDays(base, d); dates.set(d, v); } return v; };
  return (raw.h as any[]).map((r) => {
    const offers: Offer[] = (r[16] as any[]).map((o) => ({
      dep: date(o[0]), nights: o[1], meal: s[o[2]]!, airport_slug: s[o[3]]!, airport: s[o[4]]!, transport: s[o[5]]!, partner: s[o[6]]!,
      price: o[7], orig: o[8], lm: (o[9] & 1) !== 0, fm: (o[9] & 2) !== 0, adults: o[10],
    }));
    const h: Hotel = {
      id: r[0], slug: r[1], name: r[2], destination_slug: s[r[3]]!, destination: s[r[4]]!, city_slug: s[r[5]]!, stars: r[6], rating: r[7], image: r[8],
      partners_count: r[9], offers_active: r[10], min_price: r[11], price_drop_pct: r[12], bits: r[13], meal_flags: r[14], country: s[r[15]]!, country_slug: slug,
      offers, text: '',
    };
    h.text = fold([h.name, h.destination, h.city_slug.replace(/-/g, ' '), h.country].join(' '));
    return h;
  });
}

/** Landing filters + GET params (GET wins), exactly like mergeFilters() in ./index.ts. */
export function mergeParams(pathFilters: Record<string, unknown>, params: Record<string, string>, page = 1): Filters {
  const merged: Record<string, unknown> = { ...pathFilters };
  for (const k of GET_KEYS) { const v = params[k]; if (v !== undefined && v !== null && v !== '') merged[k] = v; }
  merged.page = Math.max(1, page | 0);
  return normalizeFilters(merged);
}

/** Shards a filter set needs (one country, or all of them). */
export function shardsFor(f: Filters, index: DataIndex): string[] {
  const all = index.shards.map(([n]) => n);
  if (f.country) return all.includes(f.country) ? [f.country] : [];
  const ex = new Set(f.country_exclude ?? []);
  return all.filter((n) => !ex.has(n));
}

type Pred<T> = (x: T) => boolean;

/** Hotel-level conditions (buildConditions `where`). */
function hotelPreds(f: Filters, skip: Array<'country' | 'dest' | 'stars' | 'q'> = [], facetMode = false): Array<Pred<Hotel>> {
  const p: Array<Pred<Hotel>> = [];
  if (f.country && !skip.includes('country')) p.push((h) => h.country_slug === f.country);
  if (f.country_exclude?.length && !facetMode) { const ex = new Set(f.country_exclude); p.push((h) => !ex.has(h.country_slug)); }
  if (f.dest && !skip.includes('dest')) p.push((h) => h.destination_slug === f.dest || h.city_slug === f.dest);
  if (f.city && !facetMode) p.push((h) => h.city_slug === f.city);
  if (f.q && !skip.includes('q') && !facetMode) { const words = fold(f.q).split(/[^a-z0-9]+/).filter(Boolean); if (words.length) p.push((h) => words.every((w) => h.text.includes(w))); }
  if (f.stars?.length && !skip.includes('stars')) { const st = new Set(f.stars); p.push((h) => st.has(h.stars)); }
  if (f.rating_min) p.push((h) => h.rating !== null && h.rating >= f.rating_min!);
  if (f.price_min) p.push((h) => h.min_price !== null && h.min_price >= f.price_min!);
  if (f.price_max) p.push((h) => h.min_price !== null && h.min_price <= f.price_max!);
  if (f.flag) {
    if (f.flag === 'zlevneno') p.push((h) => h.price_drop_pct >= DROP_MIN_PCT);
    else { const bit = f.flag === 'last-minute' ? B.lm : B.fm; p.push((h) => (h.bits & bit) !== 0); }
  }
  if (f.theme && THEME_BIT[f.theme]) { const bit = THEME_BIT[f.theme]!; p.push((h) => (h.bits & bit) !== 0); }
  return p;
}

/** Offer-level conditions (buildConditions `oc`); null = no offer condition at all. */
function offerPred(f: Filters, today: string, stale: boolean): Pred<Offer> | null {
  const oc: Array<Pred<Offer>> = [];
  if (f.flag === 'last-minute') oc.push((o) => o.lm);
  if (f.flag === 'first-minute') oc.push((o) => o.fm);
  if (f.meal?.length) { const m = new Set(f.meal); oc.push((o) => m.has(o.meal)); }
  if (f.airport?.length) { const a = new Set(f.airport); oc.push((o) => a.has(o.airport_slug)); }
  if (f.transport) oc.push((o) => o.transport === f.transport);
  if (f.partner?.length) { const pp = new Set(f.partner); oc.push((o) => pp.has(o.partner)); }
  if (f.date_from) oc.push((o) => o.dep >= f.date_from!);
  if (f.date_to) oc.push((o) => o.dep <= f.date_to!);
  if (f.nights_min) oc.push((o) => o.nights >= f.nights_min!);
  if (f.nights_max) oc.push((o) => o.nights <= f.nights_max!);
  if (f.adults) oc.push((o) => o.adults >= f.adults!);
  if (!oc.length && !stale) return null;
  oc.push((o) => o.dep >= today); // sellable (the shards hold active offers of fresh feeds only)
  if (f.price_max) oc.push((o) => o.price <= f.price_max!);
  if (f.price_min) oc.push((o) => o.price >= f.price_min!);
  return (o) => oc.every((c) => c(o));
}

// SQLite orders NULL before every number (ASC) — mirror it.
const n = (v: number | null): number => (v === null ? -Infinity : v);
const asc = (a: number | null, b: number | null) => n(a) - n(b);
type Row = { h: Hotel; best: Offer | null; first: string };
function comparator(sort: string): (a: Row, b: Row) => number {
  const tie = (a: Row, b: Row) => a.h.id - b.h.id;
  switch (sort) {
    case 'recommended': return (a, b) => ((b.h.bits & B.img) - (a.h.bits & B.img)) || (+(b.h.stars > 0) - +(a.h.stars > 0)) || (+(a.h.rating === null) - +(b.h.rating === null))
      || asc(b.h.rating, a.h.rating) || (b.h.offers_active - a.h.offers_active) || asc(a.h.min_price, b.h.min_price) || tie(a, b);
    case 'price-desc': return (a, b) => asc(b.h.min_price, a.h.min_price) || tie(a, b);
    case 'rating': return (a, b) => (+(a.h.rating === null) - +(b.h.rating === null)) || asc(b.h.rating, a.h.rating) || asc(a.h.min_price, b.h.min_price) || tie(a, b);
    case 'discount': return (a, b) => ((b.h.bits & B.lm) - (a.h.bits & B.lm)) || asc(a.h.min_price, b.h.min_price) || tie(a, b);
    case 'drop': return (a, b) => (b.h.price_drop_pct - a.h.price_drop_pct) || asc(a.h.min_price, b.h.min_price) || tie(a, b);
    // "Nejbližší odlet": earliest matching departure first (the SSR fell back to the price order here)
    case 'departure': return (a, b) => (a.first === b.first ? 0 : a.first === '' ? 1 : b.first === '' ? -1 : a.first < b.first ? -1 : 1) || asc(a.h.min_price, b.h.min_price) || tie(a, b);
    default: return (a, b) => asc(a.h.min_price, b.h.min_price) || tie(a, b);
  }
}

export interface RunResult { total: number; pages: number; page: number; items: Array<{ hotel: Hotel; best: Offer | null }> }

export function search(hotels: Hotel[], f: Filters, today: string, stale = false): RunResult {
  const hp = hotelPreds(f);
  const op = offerPred(f, today, stale);
  const rows: Row[] = [];
  const wantFirst = f.sort === 'departure';
  for (const h of hotels) {
    if (!hp.every((p) => p(h))) continue;
    let best: Offer | null = null; let first = '';
    for (const o of h.offers) { // sorted by price, id → the first match is bestOffers()' pick
      if (o.dep < today || (op && !op(o))) continue;
      if (!best) best = o;
      if (!wantFirst) break;
      if (first === '' || o.dep < first) first = o.dep;
    }
    if (op && !best) continue; // EXISTS (matching sellable offer)
    rows.push({ h, best, first });
  }
  rows.sort(comparator(f.sort));
  const total = rows.length;
  const start = (f.page - 1) * PER_PAGE;
  return { total, pages: Math.ceil(total / PER_PAGE), page: f.page, items: rows.slice(start, start + PER_PAGE).map((r) => ({ hotel: r.h, best: r.best })) };
}

/** Facet counts keyed like data-facet="group:value" (facets.ts compute(): hotel-level filters only). Countries only when every shard is loaded. */
export function facetCounts(hotels: Hotel[], f: Filters, withCountries: boolean): { groups: string[]; counts: Record<string, number> } {
  const counts: Record<string, number> = {}; const groups = ['stars', 'meals'];
  const pass = (h: Hotel, ps: Array<Pred<Hotel>>) => ps.every((p) => p(h));
  if (withCountries) {
    groups.push('countries');
    const ps = hotelPreds(f, ['country', 'dest'], true);
    for (const h of hotels) if (pass(h, ps)) counts['countries:' + h.country_slug] = (counts['countries:' + h.country_slug] ?? 0) + 1;
  }
  const ps = hotelPreds(f, ['stars'], true);
  const all = hotelPreds(f, [], true);
  for (const h of hotels) {
    if (h.stars > 0 && pass(h, ps)) counts['stars:' + h.stars] = (counts['stars:' + h.stars] ?? 0) + 1;
    if (pass(h, all)) for (const [slug, bit] of Object.entries(MEAL_BITS)) if ((h.meal_flags & bit) !== 0) counts['meals:' + slug] = (counts['meals:' + slug] ?? 0) + 1;
  }
  return { groups, counts };
}

// ------------------------------------------------------------------ card (1:1 with src/components/listing/CardHotel.astro)
/** Astro's attribute/text escaping (html-escaper). */
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]!);
const STAR = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.9 6.26 6.86.83-5.07 4.7 1.35 6.77L12 17.2l-6.04 3.36 1.35-6.77-5.07-4.7 6.86-.83z"/></svg>';
const PLACEHOLDER = '<div class="flex h-full w-full items-center justify-center text-slate-300" aria-hidden="true"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v14M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1"/></svg></div>';
const ratingStr = (r: number) => r.toFixed(1).replace('.', ',');

export function renderCard(h: Hotel, best: Offer | null, query = ''): string {
  let price: number | null = null; let priceOriginal: number | null = null; let discount: number | null = null;
  if (best) { price = best.price; if (best.orig && best.orig > price) { priceOriginal = best.orig; discount = Math.round(100 * (1 - price / priceOriginal)); } }
  const bits = best ? [formatDate(best.dep), nightsLabel(best.nights), MEAL_LABELS[best.meal] ?? best.meal, ...(best.airport ? ['odlet ' + best.airport] : []),
    ...(best.transport && best.transport !== 'letecky' && best.transport !== 'neuvedeno' ? [best.transport === 'vlastni' ? 'vlastní doprava' : best.transport] : [])].filter(Boolean).join(' · ') : '';
  const isLm = best ? best.lm : (h.bits & B.lm) !== 0;
  const stars = Math.max(0, Math.min(5, h.stars || 0));
  const rating = h.rating !== null && h.rating > 0 ? h.rating : null;
  const srcset = h.image ? srcsetRaw(h.image, 640) : '';
  let o = '<article class="card-k group"><div class="card-k-img">';
  o += h.image
    ? `<img src="${esc(imgUrl(h.image, 640))}"${srcset ? ` srcset="${esc(srcset)}"` : ''} sizes="(max-width:639px) 7.6rem, (min-width:1280px) 22vw, (min-width:1024px) 30vw, 45vw" alt="${esc(h.name)}" width="640" height="480" loading="lazy" decoding="async" onerror="this.style.display='none'">`
    : PLACEHOLDER;
  o += '<div class="absolute left-3 top-3 flex flex-wrap gap-1.5">' + (isLm ? '<span class="badge badge-lm">Last minute</span>' : '') + (discount !== null && discount > 0 ? `<span class="badge badge-sale">−${discount} %</span>` : '') + '</div></div>';
  o += '<div class="flex flex-1 flex-col pt-3"><div class="flex items-start justify-between gap-3"><h3 class="text-[15px] font-bold leading-snug text-ink">';
  o += `<a href="${esc(`/hotel/${h.slug}/${query}`)}" class="text-ink no-underline after:absolute after:inset-0 after:z-10 after:rounded-2xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ink">${esc(h.name)}</a></h3>`;
  if (rating !== null) o += `<span class="rating-badge" aria-label="Hodnocení ${ratingStr(rating)} z 10">${ratingStr(rating)}</span>`;
  o += '</div><p class="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500">' + countryFlagHtml(h.country, h.country_slug);
  o += `<span class="truncate">${esc(h.country)}${h.destination ? esc(` · ${h.destination}`) : ''}</span>`;
  if (stars > 0) o += `<span class="ml-auto inline-flex shrink-0 items-center gap-px text-amber-400" role="img" aria-label="${stars} z 5 hvězdiček">${STAR.repeat(stars)}</span>`;
  o += '</p>';
  if (bits) o += `<p class="text-sm text-slate-500">${esc(bits)}</p>`;
  o += '<div class="mt-auto pt-2">';
  if (price !== null) {
    o += `<p class="text-[15px] text-ink"><span class="text-slate-500">od</span> <strong class="whitespace-nowrap font-extrabold">${esc(formatPrice(price))}</strong>  <span class="text-slate-500">/ os.</span>`;
    if (priceOriginal !== null) o += `<span class="ml-1 whitespace-nowrap text-sm text-slate-400 line-through">${esc(formatPrice(priceOriginal))}</span>`;
    o += '</p>';
  }
  if (h.partners_count > 1) o += `<p class="text-sm font-semibold text-coral-dark">Porovnat ${h.partners_count} ${h.partners_count >= 5 ? 'nabídek' : 'nabídky'}</p>`;
  return o + '</div></div></article>';
}

export const cardQuery = (urlQuery: string): string => selectionQuery(urlQuery);
