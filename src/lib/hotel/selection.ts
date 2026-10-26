// The visitor's search (from the listing URL) carried into the hotel detail, so the offers that fit it come first and the
// page can say which condition a hotel cannot meet. Mirrors the offer-level filters of src/lib/search.ts.
import { MEAL_LABELS } from '../helpers';

export interface Selection {
  airport?: string[]; meal?: string[]; nights_min?: number; nights_max?: number; date_from?: string; date_to?: string;
  price_max?: number; transport?: string; partner?: string[];
}
const list = (v: string | null) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const int = (v: string | null) => { const n = parseInt(v ?? '', 10); return n > 0 ? n : undefined; };
const ymd = (v: string | null) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? '') ? (v as string) : undefined);

export function parseSelection(q: URLSearchParams): Selection | null {
  const s: Selection = {};
  const airport = list(q.get('airport')); if (airport.length) s.airport = airport;
  const meal = list(q.get('meal')); if (meal.length) s.meal = meal;
  const nmin = int(q.get('nights_min')), nmax = int(q.get('nights_max'));
  const nExact = int(q.get('nights')); if (nExact) { s.nights_min = nExact; s.nights_max = nExact; }
  if (nmin) s.nights_min = nmin; if (nmax) s.nights_max = nmax;
  const df = ymd(q.get('date_from')), dt = ymd(q.get('date_to')); if (df) s.date_from = df; if (dt) s.date_to = dt;
  const pm = int(q.get('price_max')); if (pm) s.price_max = pm;
  const tr = q.get('transport'); if (tr && ['letecky', 'autobusem', 'vlastni'].includes(tr)) s.transport = tr;
  const partner = list(q.get('partner')); if (partner.length) s.partner = partner;
  return Object.keys(s).length ? s : null;
}

export interface OfferLike { airport_slug?: string; meal_type?: string; nights?: number; departure_date?: string; price_pp?: number; transport?: string; partner_slug?: string }

/** Which conditions an offer fails (empty = it fits). Keys are stable ids used for the "what did not match" message. */
export function failedConditions(o: OfferLike, s: Selection): string[] {
  const f: string[] = [];
  if (s.airport && !s.airport.includes(String(o.airport_slug ?? ''))) f.push('airport');
  if (s.meal && !s.meal.includes(String(o.meal_type ?? ''))) f.push('meal');
  if (s.nights_min && Number(o.nights) < s.nights_min) f.push('nights');
  else if (s.nights_max && Number(o.nights) > s.nights_max) f.push('nights');
  if (s.date_from && String(o.departure_date) < s.date_from) f.push('date');
  else if (s.date_to && String(o.departure_date) > s.date_to) f.push('date');
  if (s.price_max && Number(o.price_pp) > s.price_max) f.push('price');
  if (s.transport && o.transport !== s.transport) f.push('transport');
  if (s.partner && !s.partner.includes(String(o.partner_slug ?? ''))) f.push('partner');
  return f;
}

export const CONDITION_LABEL: Record<string, string> = {
  airport: 'odletové letiště', meal: 'strava', nights: 'počet nocí', date: 'termín odjezdu', price: 'cena', transport: 'doprava', partner: 'cestovní kancelář',
};

/** Human labels of the active conditions, e.g. ["7–9 nocí", "all inclusive", "odlet z Praha"]. */
export function describeSelection(s: Selection, airportLabels: Record<string, string> = {}): string[] {
  const out: string[] = [];
  if (s.nights_min || s.nights_max) out.push(s.nights_min && s.nights_max ? (s.nights_min === s.nights_max ? `${s.nights_min} nocí` : `${s.nights_min}–${s.nights_max} nocí`) : s.nights_min ? `od ${s.nights_min} nocí` : `do ${s.nights_max} nocí`);
  if (s.meal) out.push(s.meal.map((m) => (MEAL_LABELS[m] ?? m).toLowerCase()).join(' / '));
  if (s.airport) out.push('odlet z ' + s.airport.map((a) => airportLabels[a] ?? a).join(' / '));
  if (s.date_from || s.date_to) out.push(`odjezd ${s.date_from ?? '…'} – ${s.date_to ?? '…'}`);
  if (s.price_max) out.push(`do ${s.price_max.toLocaleString('cs-CZ').replace(/ /g, ' ')} Kč`);
  if (s.transport) out.push({ letecky: 'letecky', autobusem: 'autobusem', vlastni: 'vlastní doprava' }[s.transport] ?? s.transport);
  if (s.partner) out.push('u ' + s.partner.join(' / '));
  return out;
}

const CARRY = ['airport', 'meal', 'nights', 'nights_min', 'nights_max', 'date_from', 'date_to', 'price_max', 'transport', 'partner'];
/** Listing query string reduced to the params that describe the visitor's choice (what the detail page understands); '' when none. */
export function selectionQuery(search: string | URLSearchParams): string {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const out = new URLSearchParams();
  for (const k of CARRY) { const v = q.get(k); if (v) out.set(k, v); }
  const r = out.toString();
  return r ? '?' + r : '';
}
