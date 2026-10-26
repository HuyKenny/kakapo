// Ported from Kakapo_Helpers (formatting, labels, image proxy, amenities). Pure functions, no I/O.

export const MEAL_BITS: Record<string, number> = { 'all-inclusive': 1, polopenze: 2, snidane: 4, 'plna-penze': 8, 'bez-stravy': 16 };
export const MEAL_LABELS: Record<string, string> = {
  'all-inclusive': 'All inclusive', polopenze: 'Polopenze', snidane: 'Snídaně', 'plna-penze': 'Plná penze', 'bez-stravy': 'Bez stravy',
};
export const ASSETS = '/wp-content/kakapo-assets/';

/** Slug without diacritics (WordPress sanitize_title(remove_accents(x)) equivalent for our data). */
export function slugify(text: string): string {
  return String(text ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export const COUNTRY_FLAG_CODES: Record<string, string> = {"albanie": "AL", "andorra": "AD", "bahrajn": "BH", "bahrain": "BH", "bulharsko": "BG", "cerna-hora": "ME", "ceska-republika": "CZ", "cesko": "CZ", "chorvatsko": "HR", "cina": "CN", "djerba": "TN", "dominicanska-republika": "DO", "dominicana": "DO", "dubaj": "AE", "egypt": "EG", "finsko": "FI", "francie": "FR", "indonesie": "ID", "irsko": "IE", "italie": "IT", "japonsko": "JP", "jamajka": "JM", "kanarske-ostrovy": "ES", "kapverdske-ostrovy": "CV", "kapverdy": "CV", "katar": "QA", "kena": "KE", "kostarika": "CR", "kuba": "CU", "kypr": "CY", "madarsko": "HU", "madeira": "PT", "maledivy": "MV", "mallorca": "ES", "malta": "MT", "maroko": "MA", "mauricius": "MU", "menorca": "ES", "mexiko": "MX", "nemecko": "DE", "oman": "OM", "polsko": "PL", "portugalsko": "PT", "rakousko": "AT", "recko": "GR", "sardinie": "IT", "seychely": "SC", "singapur": "SG", "slovensko": "SK", "spojene-arabske-emiraty": "AE", "sri-lanka": "LK", "spanelsko": "ES", "thajsko": "TH", "tunisko": "TN", "turecko": "TR", "usa": "US", "vietnam": "VN", "zanzibar": "TZ"};
export const PARTNER_LABELS: Record<string, string> = {"ceskekormidlo": "České kormidlo", "radynacestu": "Rady na cestu", "zazitky": "Zážitky.cz", "spa": "Spa.cz", "excursia": "CK Excursia", "invia": "Invia", "slevomat": "Slevomat", "atis": "CK ATIS", "fischer": "CK Fischer", "exim-tours": "Exim Tours", "blue-style": "Blue Style", "tui": "TUI", "dovolena-cz": "Dovolena.cz", "cedok": "Čedok"};
export const PARTNER_LOGOS: Record<string, string> = { fischer: 'svg', 'exim-tours': 'svg', 'blue-style': 'svg', bluestyle: 'svg', tui: 'svg', slevomat: 'svg', invia: 'png', 'dovolena-cz': 'png', cedok: 'png' };
const PARTNER_LOGO_ALIASES: Record<string, string> = { eximtours: 'exim-tours', exim: 'exim-tours', bluestyle: 'blue-style', dovolena: 'dovolena-cz' };

export function countryCode(country: string, slug = ''): string {
  const s = slugify(slug !== '' ? slug : country);
  return COUNTRY_FLAG_CODES[s] ?? COUNTRY_FLAG_CODES[slugify(country)] ?? '';
}
export function countryFlagUrl(country: string, slug = ''): string {
  const code = countryCode(country, slug);
  return /^[A-Z]{2}$/.test(code) ? `${ASSETS}img/flags/${code.toLowerCase()}.svg` : '';
}
export function countryFlagHtml(country: string, slug = ''): string {
  const url = countryFlagUrl(country, slug);
  if (!url) return '';
  const label = country.trim();
  return `<img src="${esc(url)}" alt="${esc(label ? 'Vlajka ' + label : 'Vlajka země')}" class="shrink-0" style="width:18px;height:13.5px;border-radius:2px;object-fit:cover" loading="lazy" decoding="async">`;
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

const IMG_PROXY_HOST = 'wsrv.nl';
export function imgUrl(url: string | null | undefined, width: number, quality = 72): string {
  const u = String(url ?? '').trim();
  if (u === '' || u[0] === '/' || /^data:/i.test(u) || !/^https?:\/\//i.test(u)) return u;
  let host = '';
  try { host = new URL(u).hostname.toLowerCase(); } catch { return u; }
  if (host === '' || host === IMG_PROXY_HOST || host.includes('kakapo.cz')) return u;
  const q = new URLSearchParams({ url: u, w: String(Math.max(1, width | 0)), q: String(Math.max(1, Math.min(100, quality | 0))), output: 'webp', we: '' });
  return `https://${IMG_PROXY_HOST}/?${q.toString()}`;
}
export function imgSrcset(url: string | null | undefined, width: number, quality = 72): string {
  const one = imgUrl(url, width, quality);
  if (one === (url ?? '')) return '';
  return `${esc(one)} 1x, ${esc(imgUrl(url, width * 2, quality))} 2x`;
}

export function formatPrice(price: number | string | null | undefined): string {
  const n = Math.round(Number(price) || 0);
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0') + '\u00A0Kč';
}
export function formatDate(ymd: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? ''));
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : '';
}
export function nightsLabel(n: number): string {
  n = Math.trunc(n);
  if (n <= 0) return '1 den';
  if (n === 1) return '1 noc';
  if (n >= 2 && n <= 4) return `${n} noci`;
  return `${n} nocí`;
}
export function countLabel(n: number, one: string, few: string, many: string): string {
  n = Math.trunc(n);
  return n === 1 ? one : n >= 2 && n <= 4 ? few : many;
}
export function jsonArr<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  try { const d = JSON.parse(String(value ?? '')); return Array.isArray(d) ? d : []; } catch { return []; }
}
export function partnerLabel(slug: string): string {
  if (PARTNER_LABELS[slug]) return PARTNER_LABELS[slug]!;
  return slug === '' ? '' : slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
function canonicalPartnerLogoSlug(slug: string): string {
  const s = slugify(slug);
  if (PARTNER_LOGO_ALIASES[s]) return PARTNER_LOGO_ALIASES[s]!;
  if (PARTNER_LOGOS[s]) return s;
  for (const base of ['fischer', 'exim-tours', 'eximtours', 'blue-style', 'bluestyle', 'tui', 'slevomat', 'invia', 'dovolena-cz', 'dovolena']) {
    if (s.startsWith(base + '-') || s.startsWith(base + '_')) return PARTNER_LOGO_ALIASES[base] ?? base;
  }
  return '';
}
export function partnerLogoUrl(slug: string): string {
  const l = canonicalPartnerLogoSlug(slug);
  return PARTNER_LOGOS[l] ? `${ASSETS}img/partners/${l}.${PARTNER_LOGOS[l]}` : '';
}

export function dedupeImageUrls(urls: unknown): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const u of Array.isArray(urls) ? urls : []) {
    const s = String(u ?? ''); if (!s) continue;
    let key = s; try { key = new URL(s).pathname; } catch { /* keep raw */ }
    if (seen.has(key)) continue; seen.add(key); out.push(s);
  }
  return out;
}

const AMENITY_MAP: Array<[string, RegExp, string]> = [
  ['bazen', /baz[ée]n/iu, 'Bazén'], ['aquapark', /aquapark|skluzavk/iu, 'Aquapark'], ['plaz', /pl[áa][žz]/iu, 'U pláže'],
  ['wifi', /wi-?fi/iu, 'Wi-Fi'], ['deti', /d[ěe]tsk/iu, 'Pro děti'], ['wellness', /wellness|\bspa\b/iu, 'Wellness & spa'],
  ['fitness', /fitness/iu, 'Fitness'], ['klimatizace', /klimatizac/iu, 'Klimatizace'], ['animace', /anima[čc]/iu, 'Animační programy'],
  ['vodni-sporty', /vodn[íi]\s+sport/iu, 'Vodní sporty'], ['tenis', /tenis/iu, 'Tenis'], ['restaurace', /restaurac/iu, 'Restaurace'],
  ['bar', /\bbar(y|u|ů|em|ech|ů?m)?(?![\p{L}])/iu, 'Bar'], ['vytah', /v[ýy]tah/iu, 'Výtah'], ['parkovani', /parkovi[šs]t|parkov[áa]n[íi]|parking/iu, 'Parkování'],
];
export function amenitiesFromText(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (!text) return out;
  for (const [slug, re, label] of AMENITY_MAP) { if (re.test(text)) out.push([slug, label]); if (out.length >= 10) break; }
  return out;
}
const AMENITY_PATHS: Record<string, string> = {"bazen": "<path d=\"M2 15c1.2.6 1.8 1 3 1s1.8-.4 3-1 1.8-1 3-1 1.8.4 3 1 1.8 1 3 1 1.8-.4 3-1M2 19.5c1.2.6 1.8 1 3 1s1.8-.4 3-1 1.8-1 3-1 1.8.4 3 1 1.8 1 3 1 1.8-.4 3-1M8 11V5a2 2 0 0 1 4 0M8 8h4\"/>", "aquapark": "<path d=\"M12 2.7 6.8 9a6.5 6.5 0 1 0 10.4 0z\"/>", "plaz": "<circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2v2M12 20v2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4\"/>", "wifi": "<path d=\"M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0\"/><circle cx=\"12\" cy=\"19.5\" r=\".6\"/>", "deti": "<circle cx=\"12\" cy=\"5.5\" r=\"2.5\"/><path d=\"M12 8v7M8 20l4-4 4 4M8.5 12h7\"/>", "wellness": "<path d=\"M12 21c4-2 7-5.2 7-9.3 0-1.9-1-3.2-2.6-3.2-1.1 0-2 .7-2.4 2 0-3-1-5-2-6-1 1-2 3-2 6-.4-1.3-1.3-2-2.4-2C5 8.5 4 9.8 4 11.7 4 15.8 8 19 12 21z\"/>", "fitness": "<path d=\"M6.5 9v6M9 7v10M15 7v10M17.5 9v6M9 12h6M3 11v2M21 11v2\"/>", "klimatizace": "<path d=\"M12 2v20M3.5 7 20.5 17M20.5 7 3.5 17M10 3.5 12 6l2-2.5M10 20.5 12 18l2 2.5M4 9.5 7 10 6.2 7M20 14.5 17 14l.8 3M20 9.5 17 10l.8-3M4 14.5 7 14l-.8 3\"/>", "animace": "<path d=\"M9 17V5l11-2v12\"/><circle cx=\"6\" cy=\"17\" r=\"2.8\"/><circle cx=\"17\" cy=\"15\" r=\"2.8\"/>", "vodni-sporty": "<path d=\"M2 7c1.2.6 1.8 1 3 1s1.8-.4 3-1 1.8-1 3-1 1.8.4 3 1 1.8 1 3 1 1.8-.4 3-1M2 12.5c1.2.6 1.8 1 3 1s1.8-.4 3-1 1.8-1 3-1 1.8.4 3 1 1.8 1 3 1 1.8-.4 3-1M2 18c1.2.6 1.8 1 3 1s1.8-.4 3-1 1.8-1 3-1 1.8.4 3 1 1.8 1 3 1 1.8-.4 3-1\"/>", "tenis": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M5.6 5.6C9 9 9 15 5.6 18.4M18.4 5.6C15 9 15 15 18.4 18.4\"/>", "restaurace": "<path d=\"M6 3v6a2 2 0 0 0 4 0V3M8 11v10M16.5 3C15 3 14 5.2 14 8c0 2 1 3 2.5 3.2V21\"/>", "bar": "<path d=\"M5 4h14l-7 8zM12 12v6M8 21h8\"/>", "vytah": "<rect x=\"5\" y=\"3\" width=\"14\" height=\"18\" rx=\"1.5\"/><path d=\"M12 7 9.5 10h5zM12 17l-2.5-3h5z\"/>", "parkovani": "<rect x=\"4\" y=\"3\" width=\"16\" height=\"18\" rx=\"2.5\"/><path d=\"M9.5 17V7h3.2a2.6 2.6 0 0 1 0 5.2H9.5\"/>"};
export function amenityIcon(slug: string): string {
  const inner = AMENITY_PATHS[slug] ?? '<path d="M20 6 9 17l-5-5"/>';
  return `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/** Strip marketing tails from raw product titles for display (does not change the stored title/slug). */
export function cleanProductTitle(title: string, partner = ''): string {
  let t = String(title ?? '').trim();
  if (t === '') return t;
  const pipe = t.indexOf('|'); if (pipe !== -1) t = t.slice(0, pipe).trim();
  t = t.replace(/\s*[-–—]\s*(CK\s+\S.*)$/u, '');
  for (const tail of ['Poznávací zájezd', 'Poznávací zájezdy', 'Poznávací okruh', 'Zájezd', 'Zájezdy', 'Eurovíkend', 'Wellness pobyt', 'Plavba']) {
    t = t.replace(new RegExp('\\s*[-–—]\\s*' + tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'u'), '');
  }
  const pl = partnerLabel(partner);
  if (pl !== '') t = t.replace(new RegExp('\\s*[-–—|]?\\s*' + pl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'u'), '');
  t = t.trim().replace(/\s*[-–—|]\s*$/u, '');
  t = t.replace(/^[ \t.\-–—|]+|[ \t.\-–—|]+$/gu, '');
  return t !== '' ? t : String(title).trim();
}
