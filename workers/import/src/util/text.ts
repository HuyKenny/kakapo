// Text helpers ported from Kakapo_Helpers (slugify, hotel dedup key, meal/transport normalisation).

const SPECIAL: Record<string, string> = { đ: 'd', Đ: 'd', ł: 'l', Ł: 'l', ß: 'ss', æ: 'ae', Æ: 'ae', ø: 'o', Ø: 'o', œ: 'oe', Œ: 'oe', þ: 'th', ð: 'd' };

/** Diacritics removed, lower-case, `[a-z0-9]` runs joined by `-` (same shape as WP remove_accents + sanitize_title). */
export function slugify(input: unknown): string {
  const s = String(input ?? '')
    .replace(/[đĐłŁßæÆøØœŒþð]/g, (c) => SPECIAL[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  return s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function removeAccents(input: unknown): string {
  return String(input ?? '')
    .replace(/[đĐłŁßæÆøØœŒþð]/g, (c) => SPECIAL[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function normalizeHotelName(name: unknown): string {
  let n = removeAccents(String(name ?? '').toLowerCase());
  n = n.replace(/\b\d\s*\*+|\*{2,}|\b\d\s*hvezd\w*/g, ' ');
  n = n.replace(/\b(hotel|resort|spa|club|aparthotel|apartments?|villa|villas|bungalows?|suites?|beach|and|the)\b|&/g, ' ');
  n = n.replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return n !== '' ? n : slugify(name);
}

/** country|city-or-destination|normalised-name (GPS geo-cell when the feed has no place). */
export function hotelDedupKey(country: string, city: string, destination: string, name: string, lat?: number | null, lng?: number | null): string {
  let place = slugify(city !== '' ? city : destination);
  if (place === '' && lat && lng) place = `geo-${lat.toFixed(2)}-${lng.toFixed(2)}`;
  return `${slugify(country)}|${place}|${normalizeHotelName(name)}`.slice(0, 191);
}

export const MEAL_BITS: Record<string, number> = { 'all-inclusive': 1, polopenze: 2, snidane: 4, 'plna-penze': 8, 'bez-stravy': 16 };

const MEAL_MAP: Record<string, string> = {
  'all-inclusive': 'all-inclusive', ai: 'all-inclusive', 'vse-v-cene': 'all-inclusive', 'ultra-all-inclusive': 'all-inclusive', 'light-all-inclusive': 'all-inclusive',
  polopenze: 'polopenze', hb: 'polopenze', 'half-board': 'polopenze',
  snidane: 'snidane', bb: 'snidane', breakfast: 'snidane', 'se-snidani': 'snidane',
  'plna-penze': 'plna-penze', fb: 'plna-penze', 'full-board': 'plna-penze',
  'bez-stravy': 'bez-stravy', oa: 'bez-stravy', ro: 'bez-stravy', 'vlastni-strava': 'bez-stravy', 'bez-stravovani': 'bez-stravy',
};
export function normalizeMeal(value: unknown): string {
  return MEAL_MAP[slugify(value)] ?? 'bez-stravy';
}

export function normalizeTransport(value: unknown): string {
  const v = slugify(value);
  if (v === '') return '';
  if (v.includes('vlastni') || v.includes('auto')) return 'vlastni';
  if (v.includes('leteck') || v.includes('letadl') || v === 'air') return 'letecky';
  if (v.includes('autobus') || v.includes('bus')) return 'autobusem';
  return v;
}

export function stripTags(html: unknown): string {
  return String(html ?? '').replace(/<[^>]*>/g, '');
}

/** Human place name from a URL slug: "playa-de-bossa" -> "Playa de Bossa". */
const SMALL = new Set(['de', 'del', 'la', 'las', 'los', 'da', 'di', 'el', 'na', 'u', 'nad', 'pod']);
export function placeLabel(slug: string): string {
  return slugify(slug).split('-').map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

export function isYmd(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today in Europe/Prague as YYYY-MM-DD (departures are local dates). */
export function pragueToday(now: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function pragueHour(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', hour12: false }).format(now)) % 24;
}
export function sqlTime(now: Date): string {
  return now.toISOString().slice(0, 19).replace('T', ' ');
}

/** Non-cryptographic 2x53-bit hash (cyrb53) — stable, sync, enough to detect changes of normalised fields. */
export function stableHash(parts: unknown[]): string {
  const s = parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('\u001f');
  const h = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
  };
  return h(0) + h(7);
}
