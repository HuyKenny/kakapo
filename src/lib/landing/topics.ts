// Topic landings (class-topic-landings.php) + partner pages (class-partner-landings.php) + longtail topics.
// Static definitions come from JSON dumped out of the PHP classes; dated windows are recomputed here
// (the dump froze them at 2026-10-26) via ruleForSlug().
import topicData from '../../data/topic-landings.json';
import longtailData from '../../data/longtail-topics.json';
import partnerConsts from '../../data/partner-consts.json';
import { rel, relHtml } from '../url';
import { partnerLabel } from '../helpers';
import { esc, formatPrice, nightsLabel, countLabel, nf, remember, FACT_TTL_MS, type Faq } from './util';
import { pragueNow, resolveRule, ruleForSlug, type Ymd } from './dates';

export interface Cta { label: string; url: string; external?: boolean }
export interface Section { h2: string; body?: string; table?: string[][]; list?: string[] }
export interface Topic {
  type?: string; listing?: boolean; partner_page?: boolean; partner?: string; last_minute?: boolean; name?: string;
  filters: Record<string, any>; path: string; label: string; eyebrow?: string; h1: string; title: string; description: string; intro: string;
  hero_image?: string; primary_cta?: Cta; secondary_cta?: Cta; cards?: Array<{ title: string; text: string; url: string; logo?: string }>;
  cards_heading?: string; cards_intro?: string; sections?: Section[]; faqs?: Faq[]; index_min?: number;
}

/** Recursively host-relativise URLs and anchors from the WordPress dump. */
function relativise<T>(v: T): T {
  if (typeof v === 'string') return (/^https?:\/\/(www\.)?kakapo\.cz(\/|$)/i.test(v) ? rel(v) : relHtml(v)) as unknown as T;
  if (Array.isArray(v)) return v.map(relativise) as unknown as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, relativise(x)])) as T;
  return v;
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Replace the dump-time year in display strings when a dated window rolled into another year. */
function applyDates(t: any, slug: string, now: Ymd): void {
  const rule = ruleForSlug(slug);
  if (!rule || !t.filters || !('date_from' in t.filters)) return;
  const oldYear = String(t.filters.date_from).slice(0, 4);
  const r = resolveRule(rule, now);
  t.filters.date_from = r.from; t.filters.date_to = r.to;
  const newYear = r.to.slice(0, 4);
  if (rule.kind === 'month' && newYear !== oldYear) {
    for (const k of ['title', 'h1', 'description', 'intro', 'label']) if (typeof t[k] === 'string') t[k] = t[k].replace(new RegExp(`\\b${oldYear}\\b`, 'g'), newYear);
    if (typeof t.year === 'number') t.year = Number(newYear);
  }
}

const topicSlugs = Object.keys(topicData as Record<string, unknown>);
export const topicPaths = (): string[] => topicSlugs.map((s) => (topicData as any)[s].path as string);

/** Static (SQL-free) topic definition with current date windows. null when unknown. */
export function getTopicStatic(slug: string, now: Ymd = pragueNow()): Topic | null {
  const raw = (topicData as Record<string, any>)[slug];
  if (!raw) return null;
  const t = relativise(clone(raw));
  applyDates(t, slug, now);
  return t as Topic;
}
export const topicExists = (slug: string) => slug in (topicData as object);
export const topicSlugList = (): string[] => topicSlugs;

export function sectionsToHtml(topic: Pick<Topic, 'sections'>): string {
  let out = '';
  for (const s of topic.sections ?? []) {
    if (!s.h2) continue;
    out += `<h2>${esc(s.h2)}</h2>`;
    if (s.body) out += s.body;
    if (Array.isArray(s.table) && s.table.length) {
      out += '<table><tbody>';
      s.table.forEach((row, i) => { out += '<tr>' + row.map((c) => `<${i === 0 ? 'th' : 'td'}>${esc(c)}</${i === 0 ? 'th' : 'td'}>`).join('') + '</tr>'; });
      out += '</tbody></table>';
    }
    if (Array.isArray(s.list) && s.list.length) out += '<ul>' + s.list.map((i) => `<li>${esc(i)}</li>`).join('') + '</ul>';
  }
  return out;
}

// ---------------------------------------------------------------- partner pages
type PartnerDef = [string, string, boolean];
export const PARTNERS = (partnerConsts as { PARTNERS: Record<string, PartnerDef> }).PARTNERS;
export const hubUrl = (slug: string): string => (PARTNERS[slug] ? `/${slug}-zajezdy/` : '');

export function partnerLinksBlock(path: string): string {
  const lm = path === '/last-minute/' || path === '/last-minute-all-inclusive/';
  if (!lm && !['/zajezdy/', '/first-minute/', '/all-inclusive/'].includes(path)) return '';
  const links: string[] = [];
  for (const [slug, p] of Object.entries(PARTNERS)) {
    if (lm) { if (!p[2]) continue; links.push(`<a href="/${slug}-last-minute/">${esc(p[0])} last minute</a>`); }
    else links.push(`<a href="/${slug}-zajezdy/">Zájezdy ${esc(p[1])}</a>`);
  }
  return links.length ? `<h2>${lm ? 'Last minute podle cestovní kanceláře' : 'Zájezdy podle cestovní kanceláře'}</h2><p>${links.join(' · ')}</p>` : '';
}

interface PFacts {
  hotels: number; offers: number; price_min: number; price_avg: number; dep_min: string; dep_max: string; ai_share: number;
  countries: Array<{ slug: string; label: string; hotels: number; price_min: number; all_min: number; cheapest_ck: string }>;
  airports: Array<{ slug: string; label: string; cnt: number }>; nights: number[];
}
async function allPartnerFacts(db: D1Database, lastMinute: boolean): Promise<Record<string, PFacts>> {
  return remember(`pfacts:${lastMinute ? 1 : 0}`, FACT_TTL_MS, async () => {
    const where = 'o.active = 1 AND o.price_pp > 0' + (lastMinute ? ' AND o.is_last_minute = 1' : '');
    const all = async (sql: string) => (await db.prepare(sql).all<any>()).results;
    const base = await all(`SELECT o.partner_slug AS p, COUNT(DISTINCT o.hotel_id) AS hotels, COUNT(*) AS offers, MIN(o.price_pp) AS price_min, AVG(o.price_pp) AS price_avg, MIN(o.departure_date) AS dep_min, MAX(o.departure_date) AS dep_max, SUM(o.meal_type = 'all-inclusive') AS ai_offers FROM offers o JOIN hotels h ON h.id = o.hotel_id AND h.hidden = 0 WHERE ${where} GROUP BY o.partner_slug`);
    const perCountry = await all(`SELECT o.partner_slug AS p, h.country_slug AS cs, h.country AS cl, COUNT(DISTINCT h.id) AS hotels, MIN(o.price_pp) AS pmin FROM offers o INNER JOIN hotels h ON h.id = o.hotel_id WHERE ${where} AND h.hidden = 0 AND h.country_slug <> '' GROUP BY o.partner_slug, h.country_slug, h.country`);
    const apRows = await all(`SELECT o.partner_slug AS p, o.airport_slug AS slug, o.airport AS label, COUNT(*) AS cnt FROM offers o WHERE ${where} AND o.airport_slug <> '' GROUP BY o.partner_slug, o.airport_slug, o.airport`);
    const nightRows = await all(`SELECT o.partner_slug AS p, o.nights AS n, COUNT(*) AS cnt FROM offers o WHERE ${where} AND o.nights > 0 GROUP BY o.partner_slug, o.nights`);
    const cheapest: Record<string, { min: number; ck: string }> = {};
    for (const r of perCountry) if (!cheapest[r.cs] || r.pmin < cheapest[r.cs]!.min) cheapest[r.cs] = { min: r.pmin, ck: r.p };
    const out: Record<string, PFacts> = {};
    for (const b of base) {
      const n = Number(b.offers); if (!b.p || n < 5) continue;
      const countries = perCountry.filter((r) => r.p === b.p).map((r) => ({ slug: r.cs, label: r.cl, hotels: Number(r.hotels), price_min: Number(r.pmin), all_min: cheapest[r.cs]?.min ?? 0, cheapest_ck: cheapest[r.cs]?.ck ?? '' })).sort((x, y) => y.hotels - x.hotels).slice(0, 6);
      out[b.p] = {
        hotels: Number(b.hotels), offers: n, price_min: Number(b.price_min), price_avg: Math.round(Number(b.price_avg)), dep_min: b.dep_min ?? '', dep_max: b.dep_max ?? '',
        ai_share: Math.round((100 * Number(b.ai_offers)) / n), countries,
        airports: apRows.filter((r) => r.p === b.p).sort((x, y) => y.cnt - x.cnt).slice(0, 4),
        nights: nightRows.filter((r) => r.p === b.p).sort((x, y) => y.cnt - x.cnt).slice(0, 3).map((r) => Number(r.n)),
      };
    }
    return out;
  });
}
const nn = (num: number, one: string, few: string, many: string) => `${nf(num)} ${countLabel(num, one, few, many)}`;
const genName = (n: string) => (n === 'Čedok' ? 'Čedoku' : n === 'Fischer' ? 'Fischeru' : n === 'Slevomat' ? 'Slevomatu' : n);
const fmtDate = (ymd: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd); return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : ''; };
const apList = (f: PFacts) => f.airports.map((a) => String(a.label || a.slug));

/** Fill in numbers and texts from the database (Kakapo_Partner_Landings::hydrate). */
export async function hydratePartner(db: D1Database, topic: Topic): Promise<Topic> {
  const partner = topic.partner ?? '';
  const def = PARTNERS[partner];
  if (!def) return topic;
  const lm = !!topic.last_minute;
  const f = (await allPartnerFacts(db, lm))[partner];
  if (!f) return topic;
  const name = topic.name ?? def[0]; const gen = def[1];
  let s = `Kakapo.cz je nezávislý srovnávač zájezdů a nepatří ${gen}. Aktuálně v něm porovnáváte ${nn(f.hotels, 'hotel', 'hotely', 'hotelů')} s ${lm ? 'last minute ' : ''}nabídkou ${genName(name)} (${nn(f.offers, 'termín', 'termíny', 'termínů')})`;
  if (f.price_min > 0) s += `, ceny od ${formatPrice(f.price_min)} za osobu`;
  topic.intro = s + '. U každé nabídky vidíte termín, stravu a letiště, rezervaci dokončíte přímo u cestovní kanceláře.';
  let d = name + (lm ? ' last minute' : ': zájezdy a pobyty') + ' — ' + nn(f.hotels, 'hotel', 'hotely', 'hotelů');
  if (f.price_min > 0) d += ' od ' + formatPrice(f.price_min);
  if (f.dep_min) d += ', odlety od ' + fmtDate(f.dep_min);
  topic.description = d + '. Porovnání cen s ostatními CK, rezervace přímo u pořadatele.';

  const numbers: string[] = [`V našem srovnání je ${nn(f.hotels, 'hotel', 'hotely', 'hotelů')} s ${lm ? 'last minute ' : ''}nabídkou ${genName(name)} a ${nn(f.offers, 'konkrétní termín', 'konkrétní termíny', 'konkrétních termínů')}.`];
  if (f.price_min > 0) numbers.push(`Nejnižší cena je ${formatPrice(f.price_min)} za osobu, průměr napříč termíny vychází na ${formatPrice(f.price_avg)}.`);
  if (f.dep_min && f.dep_max) numbers.push(`Nejbližší odlet je ${fmtDate(f.dep_min)}, nejvzdálenější termín ${fmtDate(f.dep_max)}.`);
  if (f.airports.length) numbers.push(`Nejčastěji se létá z letišť ${apList(f).join(', ')}.`);
  if (f.nights.length) numbers.push(`Nejčastější délka pobytu: ${f.nights.map(nightsLabel).join(', ')}.`);
  if (f.ai_share >= 10) numbers.push(`All inclusive je u ${f.ai_share} % termínů.`);
  const sections: Section[] = [{ h2: `${name}${lm ? ' last minute' : ''} v číslech`, body: `<p>${esc(numbers.join(' '))}</p><p class="text-sm">Čísla počítáme z vlastní databáze nabídek a aktualizujeme je několikrát denně.</p>` }];
  if (f.countries.length) {
    const table = [['Země', 'Hotelů', 'Nejnižší cena u této CK', 'Nejnižší cena napříč CK'], ...f.countries.map((c) => [c.label, nf(c.hotels), formatPrice(c.price_min), c.all_min > 0 ? formatPrice(c.all_min) : '—'])];
    sections.push({ h2: lm ? `Kam vede ${name} last minute` : `Kam vedou zájezdy ${gen}`, body: `<p>Přehled zemí, do kterých ${esc(name)} právě nabízí zájezdy${lm ? ' s blízkým odletem' : ''}, a nejnižší cena u této cestovky ve srovnání s nejnižší cenou ve všech nabídkách, které porovnáváme.</p>`, table });
    let total = 0; const best: string[] = []; const other: string[] = [];
    for (const c of f.countries) { if (c.all_min <= 0) continue; total++; if (c.price_min <= c.all_min) best.push(c.label); else if (c.cheapest_ck) other.push(`${c.label} (${partnerLabel(c.cheapest_ck)})`); }
    if (total > 0) {
      const cs: string[] = [];
      cs.push(best.length ? `U zemí ${best.join(', ')} je v tuto chvíli nejnižší cena napříč srovnávanými cestovkami právě u ${genName(name)}.` : `V žádné z uvedených zemí není ${name} právě teď nejlevnější.`);
      if (other.length) cs.push(`Jinde vychází nejníže: ${other.slice(0, 4).join('; ')}.`);
      cs.push('Porovnání se mění s každou aktualizací feedů, takže před rezervací vždy otevřete konkrétní nabídku a ověřte cenu.');
      sections.push({ h2: `Je ${name} nejlevnější?`, body: `<p>${esc(cs.join(' '))}</p>` });
    }
  }
  sections.push({ h2: 'Jak funguje rezervace přes Kakapo.cz', body: `<p>Kakapo.cz je nezávislý srovnávač a nepatří žádné cestovní kanceláři. U každé nabídky vidíte cenu, termín, stravu a odletové letiště. Rezervaci dokončíte vždy přímo u pořadatele, v tomto případě na webu ${esc(name)}, a cena zájezdu se tím nemění. Odkazy na nabídky jsou affiliate odkazy, za které můžeme získat provizi.</p>` });
  topic.sections = sections;
  const faqs: Faq[] = [
    { q: `Kolik ${lm ? 'last minute ' : ''}zájezdů ${gen} můžu na Kakapo.cz porovnat?`, a: `Aktuálně ${nn(f.hotels, 'hotel', 'hotely', 'hotelů')} a ${nn(f.offers, 'termín', 'termíny', 'termínů')}${f.price_min > 0 ? `, ceny od ${formatPrice(f.price_min)} za osobu` : ''}. Počty se mění podle denních aktualizací feedů.` },
    { q: 'Rezervuje se zájezd přímo na Kakapo.cz?', a: `Ne. Kakapo.cz je nezávislý srovnávač. Po kliknutí na nabídku pokračujete na web ${name}, kde rezervaci dokončíte a zaplatíte. Cena zájezdu se tím nemění, za odkaz můžeme získat provizi.` },
  ];
  if (f.airports.length) faqs.push({ q: `Odkud ${name} létá?`, a: `V nabídkách, které porovnáváme, jsou odlety z letišť: ${apList(f).join(', ')}. Konkrétní letiště najdete u každého termínu.` });
  if (f.countries.length) faqs.push({ q: `Do jakých zemí ${name} nabízí zájezdy?`, a: `Nejvíc hotelů máme v těchto zemích: ${f.countries.slice(0, 5).map((c) => c.label).join(', ')}. Kompletní přehled s cenami je v tabulce výše.` });
  topic.faqs = faqs;
  return topic;
}

/** Topic with partner hydration applied (Kakapo_Topic_Landings::get). */
export async function getTopic(db: D1Database, slug: string, now: Ymd = pragueNow()): Promise<Topic | null> {
  const t = getTopicStatic(slug, now);
  if (!t) return null;
  return t.partner_page ? hydratePartner(db, t) : t;
}

// ---------------------------------------------------------------- longtail topic definitions
export interface LongtailTopic {
  slug: string; label: string; h1_prefix: string; title_prefix: string; place_format?: string; filters: Record<string, any>; intent?: string;
  airport_slug?: string; airport_name?: string; airport_from?: string; last_minute_airport?: boolean; index_min?: number;
  month?: string; year?: number; sea_month?: boolean; sea_winter?: boolean; family_sea?: boolean; cheap_ai_sea?: boolean;
}
export function longtailTopic(slug: string, now: Ymd = pragueNow()): LongtailTopic | null {
  const raw = (longtailData as Record<string, any>)[slug];
  if (!raw) return null;
  const t = clone(raw) as LongtailTopic;
  const rule = ruleForSlug(slug);
  if (rule && t.filters && 'date_from' in t.filters) {
    const r = resolveRule(rule, now); t.filters.date_from = r.from; t.filters.date_to = r.to;
    if (rule.kind === 'month') t.year = r.year;
  }
  return t;
}
