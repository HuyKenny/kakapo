import { seasonYear } from '../year';
// Port of the hotel detail logic: Kakapo_Hotel_Repository (read side), Kakapo_Offer_Repository::for_hotel/real_drop_pct,
// Kakapo_Price_History (series, last_known, sparkline, hotel_months), template text blocks from templates/hotel.php and
// the hotel parts of Kakapo_Seo (title, description, robots, JSON-LD). Pure data -> view-model; markup lives in the page.
import { MEAL_LABELS, amenitiesFromText, countLabel, countryCode, esc, formatDate, formatPrice, jsonArr, nightsLabel, partnerLabel, partnerLogoUrl } from '../helpers';
import { sameDestination, similar, todayPrague, type HotelRow } from '../search';

export const HOTEL_MIN_DESC = 200;
export const HOTEL_GRACE_DAYS = 180;
export const RATING_MIN_COUNT = 3;
export const RATING_MIN_DESC = 7.0;
export const TITLE_MAX = 60;
export const DESC_MAX = 158;

export const PARTNER_COLORS: Record<string, string> = {
  fischer: '#0a58ca', 'exim-tours': '#d92626', 'blue-style': '#1e9de3', tui: '#d40e14', slevomat: '#00b2e5', invia: '#005eb8', cedok: '#164194',
};
const MONTH_NAMES = ['', 'leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
const NAME_KINDS = /^(hotel|penzion|pension|apartmán|apartman|apartmány|apartmany|vila|villa|resort|hostel|chata|chalupa|dvůr|dvur|usedlost|kemp|camping|glamping|bungalov|studia|residence|rezidence)(?![\p{L}\p{N}_])/iu;

/** "YYYY-MM-DD HH:MM:SS" wall clock in Europe/Prague (the format the WP DB stores). */
export function nowPrague(d = new Date()): string {
  const p = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d);
  return p; // sv-SE gives "YYYY-MM-DD HH:MM:SS"
}
const wall = (s: string): number => Date.parse(s.replace(' ', 'T').replace(/Z$/, '') + 'Z');

export function monthLabel(ym: string, year: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  const name = MONTH_NAMES[Number(m[2])] ?? ym;
  return Number(m[1]) === year ? name : `${name} ${m[1]}`;
}

export function withinGrace(offersLastSeen: string | null | undefined, now: string): boolean {
  const seen = String(offersLastSeen ?? '').trim();
  if (seen === '' || seen.startsWith('0000-00-00')) return false;
  const ts = wall(seen);
  if (Number.isNaN(ts)) return false;
  return ts >= wall(now) - HOTEL_GRACE_DAYS * 86400_000;
}
export function hotelIsIndexable(offersActive: number, description: string | null, imagesJson: string | null, offersLastSeen: string | null, now: string): boolean {
  const hasDesc = String(description ?? '').length >= HOTEL_MIN_DESC;
  const hasImg = !!jsonArr<string>(imagesJson)[0];
  if (!hasDesc && !hasImg) return false;
  if (Number(offersActive) > 0) return true;
  return withinGrace(offersLastSeen, now);
}

const hotelLabel = (name: string) => (NAME_KINDS.test(name.trim()) ? name.trim() : 'Hotel ' + name.trim());
const decode = (s: string) => String(s ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").trim();
export function hotelTitle(name: string, place: string, year: number): string {
  name = decode(name); place = decode(place);
  const suffix = ` ceny ${year}`; const brand = ' | Kakapo.cz';
  if ((name + suffix).length > TITLE_MAX) {
    const cut = name.slice(0, TITLE_MAX - 1); const sp = cut.lastIndexOf(' ');
    return (sp > 20 ? cut.slice(0, sp) : cut) + '…';
  }
  let title = name + suffix;
  if (place !== '' && (title + ' — ' + place).length <= TITLE_MAX) title += ' — ' + place;
  if ((title + brand).length <= TITLE_MAX) title += brand;
  return title;
}
const ratingStr = (n: number) => n.toFixed(1).replace('.', ',');
const join = (items: string[]): string => {
  const a = items.filter(Boolean);
  if (a.length < 2) return a[0] ?? '';
  const last = a.pop()!;
  return a.join(', ') + ' a ' + last;
};

import { CONDITION_LABEL, describeSelection, failedConditions, type Selection } from './selection';
import { staleFeedIds, transportLabel } from '../offers/eligibility';

export interface OfferView {
  id: number; partner_slug: string; price_pp: number; price_original: number | null; departure_date: string; return_date: string | null;
  nights: number; airport: string; meal_type: string; meal_label: string; room_type: string; is_last_minute: boolean; availability: string;
  discount: number; real_drop: number; prev_price: number | null; term: string; go_url: string;
  partner_label: string; partner_color: string; partner_logo: string;
  airport_slug: string; transport: string; transport_label: string; verified_at: string | null; price_changed_at: string | null;
  /** true when the offer fits every condition of the visitor's selection (always true without a selection) */
  matches: boolean;
}
export interface Faq { q: string; a: string }

export interface HotelView {
  hotel: any; images: string[]; amenities: Array<[string, string]>; stars: number; rating: number | null; ratingLabel: string;
  offers: OfferView[]; offersLabel: string; nearest: string; soldOut: boolean; lastKnown: { price: number; date: string } | null;
  months: Array<{ ym: string; mp: number; label: string; cheapest: boolean }>; sparkline: string;
  descriptionParas: string[]; fitPoints: string[]; checkPoints: string[]; faqs: Faq[];
  relatedLinks: Array<[string, string]>; similar: HotelRow[]; nearby: Array<{ slug: string; name: string; min_price: number | null }>; nearbyLabel: string;
  locationLine: string; breadcrumbs: Array<{ label: string; url: string }>;
  selection: { active: boolean; labels: string[]; matchCount: number; otherCount: number; unmet: string[] };
  partnersCfg: { id: number; partners: Record<string, string>; colors: Record<string, string>; logos: Record<string, string> };
  galleryCfg: { images: string[]; name: string };
  meta: { title: string; description: string; canonical: string; robots: string[]; image: string; jsonLd: Record<string, unknown>[] };
}
export type HotelResult = { kind: 'ok'; view: HotelView } | { kind: 'redirect'; to: string; status: number } | { kind: 'gone' } | null;

export interface LoadOpts {
  today?: string; now?: string; siteUrl?: string;
  /** the visitor's search from the listing URL (parseSelection) */
  selection?: Selection | null;
  /** Mirrors PHP longtail_link(): the longtail landing (h1+path) when it has enough results, else null. */
  longtailLink?: ((country: string, dest: string, topic: string) => Promise<{ h1: string; path: string } | null>) | undefined;
}

const all = async <T>(db: D1Database, sql: string, ...p: unknown[]): Promise<T[]> => (await db.prepare(sql).bind(...p).all<T>()).results;

export function realDropPct(o: { prev_price_pp?: number | null; price_pp?: number | null; price_changed_at?: string | null }, now: string): number {
  const prev = Number(o.prev_price_pp ?? 0), cur = Number(o.price_pp ?? 0), when = String(o.price_changed_at ?? '');
  if (prev <= 0 || cur <= 0 || prev <= cur || when === '') return 0;
  const ts = wall(when);
  if (Number.isNaN(ts) || ts < wall(now) - 7 * 86400_000) return 0;
  const diff = prev - cur;
  if (diff < 300 || diff / prev < 0.05) return 0;
  return Math.round((100 * diff) / prev);
}

const ORDER: Record<string, string> = {
  price: 'price_pp ASC', departure: 'departure_date ASC, price_pp ASC', nights: 'nights DESC, price_pp ASC',
  discount: '(CASE WHEN price_original > price_pp THEN (price_original - price_pp) * 1.0 / price_original ELSE 0 END) DESC',
};
/** Active offers of a hotel from today on (optionally one month YYYY-MM). */
export async function offersForHotel(db: D1Database, hotelId: number, sort = 'price', month = '', today = todayPrague(), limit = 100): Promise<any[]> {
  const order = ORDER[sort] ?? ORDER.price!;
  let monthSql = ''; const params: unknown[] = [hotelId, today];
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]);
    const next = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
    monthSql = ' AND departure_date >= ? AND departure_date < ?'; params.push(`${m[1]}-${m[2]}-01`, next);
  }
  const stale = await staleFeedIds(db);
  const staleSql = stale.length ? ` AND o.feed_id NOT IN (${stale.join(',')})` : '';
  // verified_at = last successful import of the offer's feed (the offer is active, i.e. it was in that feed); not the page load time
  return all(db, `SELECT o.*, f.last_success_at AS verified_at FROM offers o LEFT JOIN feeds f ON f.id = o.feed_id WHERE o.hotel_id = ? AND o.active = 1 AND o.departure_date >= ?${staleSql}${monthSql.replace(/departure_date/g, 'o.departure_date')} ORDER BY ${order.replace(/\b(price_pp|departure_date|nights|price_original)\b/g, 'o.$1')} LIMIT ${Math.trunc(limit)}`, ...params);
}

export function offerTerm(dep: string, ret: string | null): string {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(dep ?? ''); const r = ret ? /^(\d{4})-(\d{2})-(\d{2})/.exec(ret) : null;
  if (d && r && dep.slice(0, 10) !== (ret ?? '').slice(0, 10)) { // return == departure (stays without a return leg) shows just the day
    const depFmt = d[1] === r[1] ? `${Number(d[3])}. ${Number(d[2])}.` : `${Number(d[3])}. ${Number(d[2])}. ${d[1]}`;
    return `${depFmt} – ${Number(r[3])}. ${Number(r[2])}. ${r[1]}`;
  }
  return formatDate(dep);
}
export const goUrl = (id: number, ctx = 'hotel-detail') => `/go/${Math.trunc(id)}/?ctx=${ctx}`;

export function toOfferView(o: any, now: string, labels: Record<string, string> = {}): OfferView {
  const orig = o.price_original ? Number(o.price_original) : 0; const price = Number(o.price_pp);
  const discount = orig > price ? Math.round(100 * (1 - price / orig)) : 0;
  const real = realDropPct(o, now);
  const slug = String(o.partner_slug);
  return {
    id: Number(o.id), partner_slug: slug, price_pp: price, price_original: orig || null, departure_date: o.departure_date, return_date: o.return_date ?? null,
    nights: Number(o.nights), airport: o.airport ?? '', meal_type: o.meal_type, meal_label: MEAL_LABELS[o.meal_type] ?? o.meal_type, room_type: o.room_type ?? '',
    is_last_minute: !!o.is_last_minute, availability: o.availability, discount, real_drop: real, prev_price: real ? Number(o.prev_price_pp) : null,
    term: offerTerm(o.departure_date, o.return_date ?? null), go_url: goUrl(o.id),
    partner_label: labels[slug] ?? partnerLabel(slug) ?? slug, partner_color: PARTNER_COLORS[slug] ?? '#64748b', partner_logo: partnerLogoUrl(slug),
    airport_slug: o.airport_slug ?? '', transport: o.transport ?? '', transport_label: transportLabel(o.transport), verified_at: o.verified_at ?? null, price_changed_at: o.price_changed_at ?? null, matches: true,
  };
}

/** Sparkline from price_history rows [{d,p}] (≤ 90 points). */
export function sparklineSvg(rows: Array<{ d: string; p: number }>): string {
  if (rows.length < 2) return '';
  const prices = rows.map((r) => r.p); const min = Math.min(...prices), max = Math.max(...prices); const span = Math.max(1, max - min);
  const w = 280, h = 64, pad = 6, n = prices.length;
  const r1 = (x: number) => String(Math.round(x * 10) / 10);
  const pts = prices.map((p, i) => `${r1(pad + (w - 2 * pad) * (n > 1 ? i / (n - 1) : 0))},${r1(pad + (h - 2 * pad) * (1 - (p - min) / span))}`);
  const [lx, ly] = pts[pts.length - 1]!.split(',');
  const d0 = /^(\d{4})-(\d{2})-(\d{2})/.exec(rows[0]!.d); const from = d0 ? `${Number(d0[3])}. ${Number(d0[2])}.` : rows[0]!.d;
  return `<svg viewBox="0 0 ${w} ${h}" class="w-full" role="img" aria-label="Vývoj nejnižší ceny od ${esc(from)}: minimum ${esc(formatPrice(min))}, maximum ${esc(formatPrice(max))}" preserveAspectRatio="none">`
    + `<polyline points="${esc(pts.join(' '))}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`
    + `<circle cx="${esc(lx)}" cy="${esc(ly)}" r="3" fill="currentColor"/></svg>`;
}
export function downsample<T>(rows: T[], target = 90): T[] {
  const n = rows.length; if (n <= target) return rows;
  const step = n / target; const out: T[] = [];
  for (let i = 0; i < target; i++) out.push(rows[Math.floor(i * step)]!);
  out[target - 1] = rows[n - 1]!;
  return out;
}

async function priceSeries(db: D1Database, hotelId: number) {
  const rows = await all<{ d: string; p: number }>(db, 'SELECT snap_date AS d, min_price AS p FROM price_history WHERE hotel_id = ? ORDER BY snap_date ASC', hotelId);
  return downsample(rows);
}
async function lastKnown(db: D1Database, hotelId: number) {
  const r = await db.prepare('SELECT snap_date, min_price FROM price_history WHERE hotel_id = ? AND min_price > 0 ORDER BY snap_date DESC LIMIT 1').bind(hotelId).first<{ snap_date: string; min_price: number }>();
  return r ? { price: Number(r.min_price), date: String(r.snap_date) } : null;
}
async function hotelMonths(db: D1Database, hotelId: number, today: string) {
  return all<{ ym: string; mp: number }>(db, "SELECT substr(departure_date,1,7) AS ym, MIN(price_pp) AS mp FROM offers WHERE hotel_id = ? AND active = 1 AND departure_date >= ? GROUP BY ym ORDER BY ym ASC LIMIT 12", hotelId, today);
}
async function partnerSlugsForHotel(db: D1Database, hotelId: number, limit = 3): Promise<string[]> {
  // Cheapest first; ties resolved by offer id (what MySQL's index-order GROUP BY effectively did, verified against the live site).
  const rows = await all<{ partner_slug: string }>(db, 'SELECT partner_slug FROM offers WHERE hotel_id = ? AND active = 1 ORDER BY price_pp ASC, id ASC', hotelId);
  return [...new Set(rows.map((r) => r.partner_slug))].slice(0, limit);
}

function parseAmenities(raw: string | null): Array<[string, string]> {
  if (!raw) return [];
  try {
    const d = JSON.parse(raw);
    if (Array.isArray(d)) return d.map((v, i) => [String(i), String(v)] as [string, string]);
    if (d && typeof d === 'object') return Object.entries(d).map(([k, v]) => [k, String(v)] as [string, string]);
  } catch { /* ignore */ }
  return [];
}

export async function loadHotel(db: D1Database, slug: string, opts: LoadOpts = {}): Promise<HotelResult> {
  const now = opts.now ?? nowPrague(); const today = opts.today ?? now.slice(0, 10); const site = (opts.siteUrl ?? 'https://kakapo.cz').replace(/\/$/, '');
  const year = Number(now.slice(0, 4));
  const h = await db.prepare('SELECT * FROM hotels WHERE slug = ?').bind(slug).first<any>();
  if (!h) {
    const r = await db.prepare('SELECT to_path, status FROM redirects WHERE from_path = ?').bind(`/hotel/${slug}/`).first<{ to_path: string; status: number }>();
    if (!r) return null;
    return r.status === 410 ? { kind: 'gone' } : { kind: 'redirect', to: r.to_path, status: r.status };
  }
  if (h.hidden) return null;

  const images = jsonArr<string>(h.images_json);
  let amenities = parseAmenities(h.amenities_json);
  if (!amenities.length && h.description) amenities = amenitiesFromText(h.description);
  const stars = Math.max(0, Math.min(5, Number(h.stars) || 0));
  const rating = h.rating !== null && Number(h.rating) > 0 ? Number(h.rating) : null;

  const rawOffers = await offersForHotel(db, h.id, 'price', '', today);
  let offers = rawOffers.map((o) => toOfferView(o, now));
  const sel = opts.selection ?? null;
  const unmet: string[] = [];
  if (sel) {
    const per = offers.map((o) => failedConditions(o, sel));
    offers.forEach((o, i) => { o.matches = per[i]!.length === 0; });
    offers = [...offers].sort((a, b) => Number(b.matches) - Number(a.matches) || a.price_pp - b.price_pp);
    if (!offers.some((o) => o.matches) && offers.length) {
      // a condition is "unmet" when no offer of this hotel satisfies it on its own
      for (const key of Object.keys(CONDITION_LABEL)) if (offers.length && per.every((f) => f.includes(key))) unmet.push(CONDITION_LABEL[key]!);
    }
  }
  const matchCount = offers.filter((o) => o.matches).length;
  const n = offers.length;
  const offersLabel = n === 1 ? '1 nabídka' : n >= 2 && n <= 4 ? `${n} nabídky` : `${n} nabídek`;
  let nearest = ''; for (const o of offers) if (nearest === '' || o.departure_date < nearest) nearest = o.departure_date;
  const soldOut = n === 0;

  const monthsRaw = await hotelMonths(db, h.id, today);
  const minMp = monthsRaw.length ? Math.min(...monthsRaw.map((m) => m.mp)) : 0;
  const months = monthsRaw.map((m) => ({ ym: m.ym, mp: Number(m.mp), label: monthLabel(m.ym, year), cheapest: Number(m.mp) === minMp }));
  const known = soldOut ? await lastKnown(db, h.id) : null;
  const series = await priceSeries(db, h.id);
  const nearbyAll = await sameDestination(db, h, HOTEL_MIN_DESC, 18);
  const sim = await similar(db, h, HOTEL_MIN_DESC, 4);
  const nearbyLabel: string = h.destination !== '' ? h.destination : h.country;

  const location = [...new Set([h.city, h.destination, h.country].map((x) => String(x ?? '')).filter(Boolean))].join(', ');
  const mealSlugs = [...new Set(offers.map((o) => o.meal_type).filter(Boolean))];
  const meals = mealSlugs.map((m) => MEAL_LABELS[m] ?? m).filter(Boolean);
  const airports = [...new Set(offers.map((o) => o.airport.trim()).filter(Boolean))];
  const hasAI = mealSlugs.includes('all-inclusive');
  const prices = offers.map((o) => o.price_pp).filter(Boolean);
  const pMin = prices.length ? Math.min(...prices) : 0, pMax = prices.length ? Math.max(...prices) : 0;
  const spread = pMin > 0 ? Math.round((100 * (pMax - pMin)) / pMin) : 0;
  const nightsList = [...new Set(offers.map((o) => o.nights).filter(Boolean))].sort((a, b) => a - b);
  const ckLabels = [...new Set(offers.map((o) => o.partner_slug).filter(Boolean).map(partnerLabel))];

  const fit: string[] = [];
  if (stars >= 4) fit.push(`${stars}hvězdičkové ubytování pro cestovatele, kteří chtějí lepší hotelové zázemí.`);
  if (rating !== null && rating >= 8 && Number(h.rating_count) >= 3) fit.push(`Hosté hotel hodnotí ${ratingStr(rating)}/10 z ${Number(h.rating_count)} hodnocení — patří k lépe hodnoceným v okolí.`);
  if (hasAI) fit.push('Mezi termíny jsou i all inclusive nabídky, takže jídlo a pití řešíte jednou platbou.');
  if (nightsList.length >= 2) fit.push(`Na výběr jsou pobyty na ${join(nightsList.map(nightsLabel))}.`);

  const check: string[] = [];
  if (spread >= 10 && pMax > pMin) check.push(`Cena se mezi termíny liší o ${spread} % — od ${formatPrice(pMin)} do ${formatPrice(pMax)} za osobu.`);
  if (meals.length >= 2) check.push(`Nabídky se liší stravou (${join(meals)}), takže srovnávejte, co je v ceně.`);
  if (airports.length >= 2) check.push(`Odlety jsou z více letišť (${join(airports)}) a cena se podle nich může lišit.`);
  if (ckLabels.length >= 2) check.push(`Hotel nabízí ${ckLabels.length} cestovní kanceláře (${join(ckLabels)}) — porovnejte, co má která v ceně.`);
  if (nightsList.length >= 2) check.push('Délka pobytu se u jednotlivých termínů liší, zkontrolujte počet nocí i časy letů.');

  const faqs: Faq[] = [];
  if (pMin > 0) {
    let a = `${h.name} vychází na Kakapo.cz od ${formatPrice(pMin)} za osobu`;
    if (spread >= 10) a += `; nejdražší z aktuálních termínů stojí ${formatPrice(pMax)}, rozdíl je tedy ${spread} %`;
    faqs.push({ q: `Kolik stojí ${h.name}?`, a: `${a}. Srovnáváme ${offersLabel} a rezervace probíhá u pořadatele.` });
  }
  if (months.length >= 2) {
    let c = months[0]!; for (const m of months) if (m.mp < c.mp) c = m;
    faqs.push({ q: `Kdy je ${h.name} nejlevnější?`, a: `Z aktuálně dostupných termínů vychází nejvýhodněji ${c.label} — od ${formatPrice(c.mp)} za osobu. Ceny se ale mění podle obsazenosti.` });
  }
  if (meals.length) faqs.push({ q: `Jaká strava je v ${h.name} v ceně?`, a: `U dostupných termínů najdete ${join(meals)}. Konkrétní rozsah služeb potvrzuje pořadatel v detailu nabídky.` });
  if (airports.length) faqs.push({ q: `Odkud se do ${h.name} letí?`, a: `Aktuální termíny mají odlet z ${join(airports)}.` });
  if (ckLabels.length >= 2) faqs.push({ q: `Které cestovní kanceláře ${h.name} nabízejí?`, a: `Na Kakapo.cz srovnáváme nabídky od ${join(ckLabels)}. U stejného hotelu se mohou lišit cenou, termínem i tím, co je v ceně.` });

  let paras: string[] = [];
  if (h.description) paras = String(h.description).split(/\n+/).filter(Boolean);
  else {
    const partnerSlugs = [...new Set(offers.map((o) => o.partner_slug).filter(Boolean))];
    const nts = offers.map((o) => o.nights).filter(Boolean);
    let ntsTxt = '';
    if (nts.length) { const a = Math.min(...nts), b = Math.max(...nts); ntsTxt = a === b ? nightsLabel(a) : `${a}-${b} nocí`; }
    paras.push((String(h.name) + (location !== '' ? ` se nachází v lokalitě ${location}` : '') + `. Na Kakapo.cz u hotelu porovnáváme ${offersLabel}` + (Number(h.min_price) > 0 ? ` s cenou od ${formatPrice(h.min_price)} za osobu` : '') + '.').trim());
    const bits: string[] = [];
    if (stars > 0) bits.push(`${stars}hvězdičkové ubytování`);
    if (ntsTxt) bits.push(`pobyty na ${ntsTxt}`);
    if (meals.length) bits.push('strava: ' + meals.slice(0, 3).join(', '));
    if (airports.length) bits.push('odlety z ' + airports.slice(0, 3).join(', '));
    if (bits.length) paras.push(`V dostupných termínech najdete ${bits.join(', ')}.`);
    if (partnerSlugs.length) paras.push('Rezervaci dokončíte u ' + partnerSlugs.slice(0, 3).map(partnerLabel).join(', ') + '.');
  }

  const related: Array<[string, string]> = [];
  if (h.country_slug) {
    related.push([`Dovolená ${h.country}`, `/${h.country_slug}/`]);
    const lt = opts.longtailLink;
    if (lt) for (const t of ['all-inclusive', 'last-minute']) { const c = await lt(h.country_slug, '', t); if (c) related.push([c.h1, c.path]); }
    if (h.destination_slug) {
      related.push([String(h.destination), `/${h.country_slug}/${h.destination_slug}/`]);
      if (lt) { const c = await lt(h.country_slug, h.destination_slug, 'all-inclusive'); if (c) related.push([c.h1, c.path]); }
    }
  }
  related.push(['Dovolená u moře all inclusive', '/dovolena-u-more-all-inclusive/'], ['Last minute all inclusive', '/last-minute-all-inclusive/']);

  const breadcrumbs = [{ label: 'Domů', url: '/' }] as Array<{ label: string; url: string }>;
  if (h.country_slug) breadcrumbs.push({ label: h.country, url: `/${h.country_slug}/` });
  if (h.destination_slug && h.country_slug) breadcrumbs.push({ label: h.destination, url: `/${h.country_slug}/${h.destination_slug}/` });
  breadcrumbs.push({ label: h.name, url: '' });

  const partnersMap: Record<string, string> = {}; const logos: Record<string, string> = {};
  for (const s of new Set([...Object.keys(PARTNER_COLORS), ...offers.map((o) => o.partner_slug)])) { partnersMap[s] = partnerLabel(s); logos[s] = partnerLogoUrl(s); }

  // ---- meta (Kakapo_Seo::meta for the hotel page)
  const place = [h.destination, h.country].filter(Boolean).join(', ');
  const priceTxt = h.min_price ? ' od ' + formatPrice(h.min_price) : '';
  const ratingPart = Number(h.rating_count ?? 0) >= RATING_MIN_COUNT && Number(h.rating ?? 0) >= RATING_MIN_DESC ? ` Hodnocení ${ratingStr(Number(h.rating))}/10.` : '';
  const ckSlugs = (await partnerSlugsForHotel(db, h.id, 3)).map(partnerLabel).filter(Boolean);
  const ckText = ckSlugs.length >= 2 ? ckSlugs.slice(0, -1).join(', ') + ' a ' + ckSlugs[ckSlugs.length - 1] : ckSlugs[0] ?? '';
  const ckN = Math.max(1, Number(h.partners_count));
  const ckSentence = ckText !== '' ? `Porovnejte ceny, termíny a stravu od ${ckText}.` : `Porovnejte ceny, termíny a stravu od ${ckN} ${countLabel(ckN, 'cestovní kanceláře', 'cestovních kanceláří', 'cestovních kanceláří')}.`;
  const offersN = Number(h.offers_active ?? 0);
  const offersPart = offersN > 1 ? ` — ${offersN} ${countLabel(offersN, 'nabídka', 'nabídky', 'nabídek')}` : '';
  let desc: string;
  if (offersN > 0) {
    desc = hotelLabel(h.name) + (place ? ` (${place})` : '') + priceTxt + offersPart + '. ' + ckSentence + ratingPart;
    if (desc.length <= 112) desc += ' Rezervace přímo u pořadatele.';
  } else {
    const last = await lastKnown(db, h.id);
    desc = hotelLabel(h.name) + (place ? ` (${place})` : '') + ' — aktuálně bez volných termínů.';
    if (last) desc += ` Naposledy od ${formatPrice(last.price)}.`;
    desc += ' Ukážeme vývoj ceny a hotely se stejnou destinací, které termíny mají.';
  }
  const canonical = `${site}/hotel/${h.slug}/`;
  const meta = {
    title: hotelTitle(h.name, place, seasonYear()), description: desc.slice(0, DESC_MAX), canonical,
    robots: hotelIsIndexable(h.offers_active, h.description, h.images_json, h.offers_last_seen, now) ? ['index', 'follow'] : ['noindex', 'follow'],
    image: images[0] ?? '', jsonLd: [] as Record<string, unknown>[],
  };

  // ---- JSON-LD (@graph: breadcrumb, hotel, webpage, faq)
  const cc = countryCode(h.country, h.country_slug);
  const hotelLd: Record<string, unknown> = {
    '@type': 'Hotel', '@id': canonical + '#hotel', name: h.name, url: canonical,
    address: { '@type': 'PostalAddress', addressCountry: cc !== '' ? cc : h.country, addressLocality: h.city !== '' ? h.city : h.destination },
  };
  if (images.length) hotelLd.image = images.slice(0, 5);
  const descLd = String(h.description ?? '').replace(/<[^>]*>/g, '').trim();
  if (descLd !== '') hotelLd.description = descLd.replace(/\s+/g, ' ').slice(0, 600);
  if (h.min_price) hotelLd.priceRange = 'od ' + formatPrice(h.min_price);
  if (amenities.length) hotelLd.amenityFeature = amenities.slice(0, 12).map(([, a]) => ({ '@type': 'LocationFeatureSpecification', name: a, value: true }));
  if (h.lat !== null && h.lng !== null) hotelLd.hasMap = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(String(h.lat))}&mlon=${encodeURIComponent(String(h.lng))}#map=15/${h.lat}/${h.lng}`;
  if (Number(h.stars) > 0) hotelLd.starRating = { '@type': 'Rating', ratingValue: String(h.stars) };
  if (h.rating !== null && Number(h.rating) > 0 && Number(h.rating_count) >= RATING_MIN_COUNT)
    hotelLd.aggregateRating = { '@type': 'AggregateRating', ratingValue: String(Math.round(Number(h.rating) * 10) / 10), bestRating: '10', ratingCount: Number(h.rating_count) };
  if (offersN > 0 && h.min_price) {
    const mo: Record<string, unknown> = { '@type': 'AggregateOffer', priceCurrency: 'CZK', lowPrice: String(Math.trunc(h.min_price)), offerCount: String(offersN), availability: 'https://schema.org/InStock' };
    if (pMax > Math.trunc(h.min_price)) mo.highPrice = String(pMax);
    hotelLd.makesOffer = mo;
  }
  if (h.lat !== null) hotelLd.geo = { '@type': 'GeoCoordinates', latitude: Number(h.lat), longitude: Number(h.lng) };
  const graph: Record<string, unknown>[] = [
    { '@type': 'BreadcrumbList', '@id': canonical + '#breadcrumb', itemListElement: breadcrumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.label, ...(c.url ? { item: site + c.url } : {}) })) },
    hotelLd,
  ];
  if (h.updated_at) {
    const web: Record<string, unknown> = { '@type': 'WebPage', '@id': canonical + '#webpage', url: canonical, inLanguage: 'cs-CZ', dateModified: new Date(wall(String(h.updated_at))).toISOString().replace(/\.\d+Z$/, '+00:00'), mainEntity: { '@id': canonical + '#hotel' }, breadcrumb: { '@id': canonical + '#breadcrumb' }, name: meta.title, description: meta.description };
    if (images.length) web.primaryImageOfPage = images[0];
    graph.push(web);
  }
  const faqItems = faqs.filter((f) => f.q && f.a).map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }));
  if (faqItems.length) graph.push({ '@type': 'FAQPage', mainEntity: faqItems });
  meta.jsonLd = [{ '@context': 'https://schema.org', '@graph': graph }];

  return {
    kind: 'ok',
    view: {
      hotel: h, images, amenities, stars, rating,
      ratingLabel: rating === null ? '' : rating >= 9 ? 'Vynikající' : rating >= 8 ? 'Výborné' : rating >= 7 ? 'Velmi dobré' : 'Dobré',
      offers, offersLabel, nearest, soldOut, lastKnown: known, months, sparkline: sparklineSvg(series),
      descriptionParas: paras, fitPoints: fit, checkPoints: check, faqs, relatedLinks: related, similar: sim, nearby: nearbyAll, nearbyLabel,
      selection: { active: !!sel, labels: sel ? describeSelection(sel) : [], matchCount, otherCount: n - matchCount, unmet },
    locationLine: [h.country, h.destination, h.city].filter(Boolean).join(' › '), breadcrumbs,
      partnersCfg: { id: h.id, partners: partnersMap, colors: PARTNER_COLORS, logos },
      galleryCfg: { images: images.map((u) => galleryImg(u)), name: String(h.name) }, meta,
    },
  };
}
import { imgUrl } from '../helpers';
const galleryImg = (u: string) => imgUrl(u, 1280, 78);
