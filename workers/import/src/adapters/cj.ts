// CJ (Commission Junction) adapters: GraphQL Product API client + per-partner URL parsers
// (port of Kakapo_Cj_Client / Kakapo_Cj_Mapper). Travel details are encoded in the product URL, differently per partner.
import { isYmd, placeLabel, removeAccents, slugify } from '../util/text';

export const CJ_ENDPOINT = 'https://ads.api.cj.com/query';
export const CJ_PAGE_SIZE = 500;

const COUNTRIES: Record<string, string> = {
  recko: 'Řecko', spanelsko: 'Španělsko', turecko: 'Turecko', egypt: 'Egypt', bulharsko: 'Bulharsko', chorvatsko: 'Chorvatsko', italie: 'Itálie', kypr: 'Kypr', malta: 'Malta',
  tunisko: 'Tunisko', maroko: 'Maroko', portugalsko: 'Portugalsko', madeira: 'Madeira', 'kanarske-ostrovy': 'Kanárské ostrovy', kapverdy: 'Kapverdy', 'kapverdske-ostrovy': 'Kapverdy',
  tanzanie: 'Tanzánie', zanzibar: 'Zanzibar', kena: 'Keňa', mauricius: 'Mauricius', seychely: 'Seychely', maledivy: 'Maledivy', 'sri-lanka': 'Srí Lanka', thajsko: 'Thajsko',
  vietnam: 'Vietnam', indonesie: 'Indonésie', bali: 'Bali', 'dominikanska-republika': 'Dominikánská republika', dominikana: 'Dominikánská republika', kuba: 'Kuba', mexiko: 'Mexiko',
  'spojene-arabske-emiraty': 'Spojené arabské emiráty', emiraty: 'Spojené arabské emiráty', oman: 'Omán', jordansko: 'Jordánsko', izrael: 'Izrael', albanie: 'Albánie',
  'cerna-hora': 'Černá Hora', slovinsko: 'Slovinsko', francie: 'Francie', rakousko: 'Rakousko', slovensko: 'Slovensko', cesko: 'Česko', 'ceska-republika': 'Česko', madarsko: 'Maďarsko',
  polsko: 'Polsko', nemecko: 'Německo', gruzie: 'Gruzie', grecko: 'Řecko', greece: 'Řecko', cyprus: 'Kypr', ciprus: 'Kypr', 'severni-kypr': 'Kypr',
  'arabske-emiraty': 'Spojené arabské emiráty', sae: 'Spojené arabské emiráty', dubaj: 'Spojené arabské emiráty', 'abu-dhabi': 'Spojené arabské emiráty',
  'dominikanska-rep': 'Dominikánská republika', 'dominican-republic': 'Dominikánská republika', spanielsko: 'Španělsko', 'balearske-ostrovy': 'Španělsko', baleary: 'Španělsko',
  'mallorca-spanelsko': 'Španělsko', turkey: 'Turecko', 'turecko-riviera': 'Turecko', 'egypt-hurghada': 'Egypt', reunion: 'Réunion', 'zanzibar-tanzanie': 'Zanzibar',
};
const AIRPORTS: Record<string, string> = {
  PRG: 'Praha', BRQ: 'Brno', OSR: 'Ostrava', PED: 'Pardubice', KLV: 'Karlovy Vary', BTS: 'Bratislava', KSC: 'Košice', VIE: 'Vídeň', KTW: 'Katovice', KRK: 'Krakov',
  WRO: 'Vratislav', BUD: 'Budapešť', DRS: 'Drážďany', LNZ: 'Linec', MUC: 'Mnichov',
};
const MEAL_CODES: Record<string, string> = {
  AI: 'all-inclusive', AS: 'all-inclusive', UAI: 'all-inclusive', UA: 'all-inclusive', LAI: 'all-inclusive',
  BB: 'snidane', HB: 'polopenze', HBP: 'polopenze', FB: 'plna-penze', FBP: 'plna-penze',
  RO: 'bez-stravy', OA: 'bez-stravy', SC: 'bez-stravy', NN: 'bez-stravy',
};
const countryLabel = (slug: string) => COUNTRIES[slugify(slug)] ?? placeLabel(slug);

export interface CjProduct {
  id?: string; title?: string; description?: string; link?: string; imageLink?: string; additionalImageLink?: string[];
  price?: { amount?: number | string; currency?: string }; salePrice?: { amount?: number | string; currency?: string };
  customLabel1?: string | number; isDeleted?: boolean; linkCode?: { clickUrl?: string };
}
type R = Record<string, unknown>;

function parseUrl(link: string): { segments: string[]; q: URLSearchParams } | null {
  try {
    const u = new URL(link);
    return { segments: u.pathname.split('/').filter(Boolean), q: u.searchParams };
  } catch { return null; }
}

function mealFromText(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('all inclusive') || t.includes('all-inclusive')) return 'all-inclusive';
  if (t.includes('polopenz')) return 'polopenze';
  if (t.includes('plná penze') || t.includes('plnou penz')) return 'plna-penze';
  if (t.includes('snídan')) return 'snidane';
  return '';
}

function parseAtcom(link: string, hotel: R, offer: R) {
  const u = parseUrl(link); if (!u) return;
  const { segments: seg, q } = u;
  if (seg.length >= 4) { hotel.country = countryLabel(seg[0]!); hotel.destination = placeLabel(seg[1]!); hotel.city = placeLabel(seg[2]!); }
  else if (seg.length === 3) { hotel.country = countryLabel(seg[0]!); hotel.destination = placeLabel(seg[1]!); }
  if (q.get('GIATA')) hotel.giata_id = parseInt(q.get('GIATA')!, 10) || null;
  if (q.get('DI')) offer.meal_type = MEAL_CODES[q.get('DI')!.toUpperCase()] ?? '';
  if (q.get('NN')) offer.nights = parseInt(q.get('NN')!, 10) || undefined;
  if (isYmd(q.get('DD'))) offer.departure_date = q.get('DD');
  if (isYmd(q.get('RD'))) offer.return_date = q.get('RD');
}
function parseBluestyle(link: string, p: CjProduct, hotel: R, offer: R) {
  const u = parseUrl(link); if (!u) return;
  const { segments: seg, q } = u;
  if (seg.length >= 3) { hotel.country = countryLabel(seg[0]!); hotel.destination = placeLabel(seg[1]!); }
  const pct = parseInt(String(p.customLabel1 ?? 0), 10) || 0;
  if (pct >= 10 && pct <= 100) hotel.rating = Math.round(pct) / 10;
  if (isYmd(q.get('date'))) offer.departure_date = q.get('date');
  if (q.get('duration')) offer.nights = parseInt(q.get('duration')!, 10) || undefined;
  if (q.get('room1')) { const room = q.get('room1')!.split('|'); offer.meal_type = MEAL_CODES[(room[room.length - 1] ?? '').trim().toUpperCase()] ?? ''; }
}
function parseTui(link: string, hotel: R, offer: R) {
  const u = parseUrl(link); if (!u) return;
  const seg = u.segments;
  if (seg.length >= 3 && seg[0] === 'dovolena') { hotel.country = countryLabel(seg[1]!); hotel.destination = placeLabel(seg[2]!); }
  const idx = seg.indexOf('OfferCodeWS');
  const code = idx >= 0 ? seg[idx + 1] ?? '' : '';
  if (code === '') return;
  const iata = code.slice(0, 3).toUpperCase();
  if (AIRPORTS[iata]) offer.airport = AIRPORTS[iata];
  const dates: string[] = [];
  for (const m of code.matchAll(/(20\d{2})(\d{2})(\d{2})/g)) {
    const ymd = `${m[1]}-${m[2]}-${m[3]}`;
    if (isYmd(ymd)) dates.push(ymd);
  }
  if (dates.length) {
    dates.sort();
    offer.departure_date = dates[0];
    if (dates[dates.length - 1]! > dates[0]!) offer.return_date = dates[dates.length - 1];
  }
  const nm = /L(\d{2})/.exec(code);
  if (nm) offer.nights = parseInt(nm[1]!, 10);
}

const money = (v: unknown) => Math.round(Number(v ?? 0) || 0);

/** CJ hotel product -> raw {hotel, offers}; null for deleted / unusable products. */
export function mapCjHotel(p: CjProduct, parser: string): { hotel: R; offers: R[] } | null {
  if (p.isDeleted) return null;
  const title = (p.title ?? '').trim(), link = p.link ?? '', click = p.linkCode?.clickUrl ?? '';
  const price = money(p.price?.amount), sale = money(p.salePrice?.amount);
  if (title === '' || link === '' || click === '' || price <= 0) return null;
  let price_pp = price, price_original = 0;
  if (sale > 0 && sale < price) { price_pp = sale; price_original = price; }
  const hotel: R = { name: title, description: (p.description ?? '').trim(), images: [p.imageLink, ...(p.additionalImageLink ?? [])].filter(Boolean) };
  const offer: R = { external_id: String(p.id ?? ''), price_pp, price_original, currency: p.price?.currency || 'CZK', affiliate_url: click, image_url: p.imageLink ?? '' };
  if (parser === 'atcom') parseAtcom(link, hotel, offer);
  else if (parser === 'bluestyle') parseBluestyle(link, p, hotel, offer);
  else if (parser === 'tui') parseTui(link, hotel, offer);
  if (!offer.meal_type) offer.meal_type = mealFromText(String(hotel.description));
  if (!offer.departure_date) return null; // no date, no offer
  return { hotel, offers: [offer] };
}

const SPA_CITIES: Array<[string, string]> = [
  ['karlov', 'Karlovy Vary'], ['mariansk', 'Mariánské Lázně'], ['frantisk', 'Františkovy Lázně'], ['plzn', 'Plzeň'], ['jachym', 'Jáchymov'], ['podebrad', 'Poděbrady'],
  ['luhacov', 'Luhačovice'], ['teplic', 'Teplice'], ['trebon', 'Třeboň'], ['lednic', 'Lednice'], ['olomouc', 'Olomouc'], ['ostrav', 'Ostrava'], ['prah', 'Praha'], ['praze', 'Praha'],
];
/** CJ product -> non-hotel product (wellness packages). */
export function mapCjProduct(p: CjProduct, parser: string): R | null {
  if (p.isDeleted) return null;
  const title = (p.title ?? '').trim(), click = p.linkCode?.clickUrl ?? '';
  const price = money(p.price?.amount), sale = money(p.salePrice?.amount);
  if (title === '' || click === '' || price <= 0) return null;
  const product: R = {
    external_id: String(p.id ?? ''), title, description: (p.description ?? '').trim(), price: sale > 0 && sale < price ? sale : price,
    currency: p.price?.currency || 'CZK', images: [p.imageLink, ...(p.additionalImageLink ?? [])].filter(Boolean), affiliate_url: click, country: 'Česko',
  };
  if (parser === 'spa') {
    const h = removeAccents(title.toLowerCase());
    const m = /na\s+(\d+)\s+noc/.exec(h);
    if (m) product.nights = parseInt(m[1]!, 10); else if (h.includes('vikend')) product.nights = 2;
    const city = SPA_CITIES.find(([needle]) => h.includes(needle));
    if (city) { product.place = city[1]; product.destination = city[1]; }
    product.type_raw = h.includes('pivni') ? 'Pivní lázně' : h.includes('romantick') ? 'Romantický pobyt' : h.includes('wellness') || h.includes('spa') ? 'Wellness' : 'Wellness pobyt';
    product._categories = [String(product.type_raw)];
  }
  if (parser === 'fna') {
    const h = removeAccents(`${title} ${cjProductSlug(p.link)}`.toLowerCase());
    const m = /(\d+)\s*(?:noc|noci|nocich)\b/.exec(h);
    if (m) product.nights = parseInt(m[1]!, 10); else if (/\bnoc\b|vikend|pobyt/.test(h)) product.nights = h.includes('vikend') ? 2 : 1;
    product.type_raw = 'Zážitkový pobyt';
    product._categories = [String(product.type_raw)];
  }
  return product;
}

export interface CjConfig { ad_id?: string; partner_id?: string; parser?: string; force_type?: string; default_type?: string; only_slugs?: string[] }
/** Last path segment of the partner's product URL (the partner's own product slug). */
export const cjProductSlug = (link: string | undefined): string => (link ?? '').split(/[?#]/)[0]!.replace(/\/+$/, '').split('/').pop() ?? '';
export interface CjSecrets { token: string; cid: string; pid: string }

export function cjQuery(cfg: CjConfig, secrets: CjSecrets, offset: number, limit: number): string {
  const filter = cfg.partner_id ? cfg.partner_id : cfg.ad_id ?? '';
  const key = cfg.partner_id ? 'partnerIds' : 'adIds';
  if (!/^\d+$/.test(filter) || !/^\d+$/.test(secrets.cid) || !/^\d+$/.test(secrets.pid)) throw new Error('CJ config: ids must be numeric');
  return `{ products(companyId: "${secrets.cid}", ${key}: ["${filter}"], offset: ${offset | 0}, limit: ${limit | 0}) {
    totalCount resultList { id title description brand link imageLink additionalImageLink price { amount currency } salePrice { amount currency }
      customLabel0 customLabel1 customLabel2 customLabel3 customLabel4 lastUpdated isDeleted linkCode(pid: "${secrets.pid}") { clickUrl } } } }`;
}

export async function fetchCjPage(fetcher: typeof fetch, cfg: CjConfig, secrets: CjSecrets, offset: number, limit = CJ_PAGE_SIZE): Promise<{ products: CjProduct[]; total: number }> {
  const res = await fetcher(CJ_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secrets.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: cjQuery(cfg, secrets, offset, limit) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`CJ API HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { products?: { totalCount?: number; resultList?: CjProduct[] } }; errors?: Array<{ message?: string }> };
  if (body.errors?.length) throw new Error('CJ API: ' + (body.errors[0]?.message ?? 'unknown error').slice(0, 200));
  const d = body.data?.products;
  return { products: d?.resultList ?? [], total: d?.totalCount ?? 0 };
}
