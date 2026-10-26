// Meta / JSON-LD for listing, topic and home pages. Port of Kakapo_Seo (title budget, landing description, noindex rules).
import { formatPrice, jsonArr } from '../helpers';
import type { HotelRow, SearchResult } from '../search';
import type { Faq } from './landing-types';

/** wp_strip_all_tags equivalent (plus entity decode for plain text use) */
export const stripTags = (h: string): string => String(h ?? '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

export const TITLE_MAX = 60;
export const DESC_MAX = 158;
export const SITE = 'https://kakapo.cz';

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
export const nfi = (n: number) => Math.trunc(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function titleBudget(core: string): string {
  core = decode(core.trim());
  const brand = ' | Kakapo.cz';
  for (const extra of [' — ceny a termíny', ' — ceny', '']) if ([...(core + extra + brand)].length <= TITLE_MAX) return core + extra + brand;
  for (const extra of [' — ceny a termíny', ' — ceny']) if ([...(core + extra)].length <= TITLE_MAX) return core + extra;
  return core;
}
export function landingTitle(ctx: { title?: string | undefined; h1?: string | undefined }): string {
  const title = decode(String(ctx.title ?? '').trim());
  if (title !== '' && [...title].length <= TITLE_MAX) return title;
  const core = String(ctx.h1 ?? '').trim();
  return core !== '' ? titleBudget(core) : title;
}
export const topicTitle = (t: { title?: string | undefined; h1?: string | undefined; label?: string | undefined }) => landingTitle({ title: t.title, h1: t.h1 ?? t.label });

/** "5. 10." — PHP date_i18n('j. n.') */
const dayMonth = (ymd: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd); return m ? `${Number(m[3])}. ${Number(m[2])}.` : ''; };

export interface ProbeInfo { min: number }
/** Description with real numbers instead of template filler (landing_description). */
export function landingDescription(ctx: { h1?: string | undefined; description?: string | undefined; filters?: Record<string, unknown> | undefined }, total: number, result: SearchResult, probeMin: number, today: string): string {
  const base = String(ctx.description ?? '');
  const label = String(ctx.h1 ?? '').trim();
  if (total <= 0 || label === '') return base;
  const word = total === 1 ? 'hotel' : total >= 2 && total <= 4 ? 'hotely' : 'hotelů';
  let head = `${label}: ${nfi(total)} ${word}`;
  if (probeMin > 0) head += ' od ' + formatPrice(probeMin);
  if (ctx.filters?.sort === 'departure') {
    const dep = String(result.hotels[0]?.best_offer?.departure_date ?? '');
    if (dep && dep >= today) head += ', odlety od ' + dayMonth(dep);
  }
  head = head.replace(/[. ]+$/, '');
  let desc = head + '. Porovnejte a rezervujte přímo u pořadatele bez příplatku.';
  if ([...desc].length > DESC_MAX) desc = head + '. Rezervace přímo u pořadatele.';
  const chars = [...desc];
  return chars.length > DESC_MAX ? chars.slice(0, DESC_MAX - 1).join('').trimEnd() + '…' : desc;
}

export const DEST_PHOTO_SLUGS = ['cesko', 'recko', 'turecko', 'spanelsko', 'bulharsko', 'egypt', 'tunisko', 'italie', 'kypr', 'kanarske-ostrovy', 'portugalsko', 'chorvatsko', 'madeira', 'malta', 'spojene-arabske-emiraty', 'maledivy', 'zanzibar'];

/** Kakapo_Landing_Pages::normalize_faqs — max 8, empty answers dropped. */
export function normalizeFaqs(faqs: unknown): Faq[] {
  const out: Faq[] = [];
  if (!Array.isArray(faqs)) return out;
  for (const f of faqs) {
    if (!f || typeof f !== 'object') continue;
    const q = stripTags(String((f as any).q ?? '')).trim(); const a = String((f as any).a ?? '');
    if (q === '' || stripTags(a).trim() === '') continue;
    out.push({ q, a });
    if (out.length >= 8) break;
  }
  return out;
}

const faqLd = (faqs: Faq[]) => ({ '@type': 'FAQPage', mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: stripTags(f.a) } })) });
export function breadcrumbLd(crumbs: Array<{ label: string; url?: string | undefined }>, canonical: string) {
  return { '@type': 'BreadcrumbList', '@id': canonical + '#breadcrumb', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.label, ...(c.url ? { item: abs(c.url) } : {}) })) };
}
export const abs = (u: string) => (/^https?:\/\//.test(u) ? u : SITE + (u.startsWith('/') ? u : '/' + u));
const itemListLd = (hotels: HotelRow[]) => ({
  '@type': 'ItemList',
  itemListElement: hotels.slice(0, 12).map((h, i) => {
    const img = jsonArr<string>(h.images)[0] ?? '';
    return { '@type': 'ListItem', position: i + 1, url: `${SITE}/hotel/${h.slug}/`, name: String(h.name), ...(img ? { image: img } : {}) };
  }),
});
export const graph = (graphs: unknown[]) => ({ '@context': 'https://schema.org', '@graph': graphs });

export function listingLd(opts: { crumbs: Array<{ label: string; url?: string | undefined }>; canonical: string; indexable: boolean; faqs: Faq[]; hotels: HotelRow[] }) {
  const g: unknown[] = [breadcrumbLd(opts.crumbs, opts.canonical)];
  if (opts.indexable) {
    if (opts.faqs.length) g.push(faqLd(opts.faqs));
    const il = itemListLd(opts.hotels); if (il.itemListElement.length) g.push(il);
  }
  return graph(g);
}
export function topicLd(opts: { crumbs: Array<{ label: string; url?: string | undefined }>; canonical: string; indexable: boolean; faqs: Faq[]; cards: Array<{ url?: string; title?: string; logo?: string }> }) {
  const g: unknown[] = [breadcrumbLd(opts.crumbs, opts.canonical)];
  if (opts.indexable) {
    const faqs = opts.faqs.filter((f) => f.q && stripTags(f.a));
    if (faqs.length) g.push(faqLd(faqs));
    const items = opts.cards.filter((c) => c.url && c.title).map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(String(c.url)), name: String(c.title), ...(c.logo ? { image: abs(String(c.logo)) } : {}) }));
    if (items.length) g.push({ '@type': 'ItemList', itemListElement: items });
  }
  return graph(g);
}

export function homeFaqs(): Faq[] {
  const l = (p: string, t: string) => `<a href="${p}">${t}</a>`;
  return [
    { q: 'Kdy je dovolená nejlevnější?', a: `Nejlevnější je dovolená mimo hlavní letní prázdniny — v květnu, červnu a září, kdy je moře teplé, ale ceny i počet turistů nižší. Ušetříte také s ${l('/last-minute/', 'last minute')} nabídkami s blízkým odletem, nebo naopak rezervací ${l('/first-minute/', 'first minute')} s velkým předstihem.` },
    { q: 'Kam na dovolenou k moři v roce 2026?', a: `Nejoblíbenější destinace na dovolenou u moře jsou ${l('/recko/', 'Řecko')}, ${l('/turecko/', 'Turecko')}, ${l('/egypt/', 'Egypt')}, ${l('/spanelsko/', 'Španělsko')} a ${l('/bulharsko/', 'Bulharsko')}. Řecko a Turecko nabízejí jistotu teplého moře a all inclusive hotelů, Egypt celoroční teplo, Bulharsko levnou rodinnou dovolenou.` },
    { q: 'Co znamená all inclusive?', a: `All inclusive znamená, že v ceně zájezdu máte ubytování, stravu i nápoje (často i alkoholické) po celý pobyt, obvykle formou bufetu. Je ideální pro rodiny s dětmi a všechny, kdo nechtějí na dovolené řešit útratu. Prohlédněte si ${l('/all-inclusive/', 'all inclusive dovolenou')}.` },
    { q: 'Která cestovní kancelář je nejlepší?', a: 'Neexistuje jedna nejlepší cestovní kancelář — záleží na destinaci, termínu a ceně. Kakapo.cz proto porovnává nabídky prověřených českých cestovek (Fischer, Exim Tours, Blue Style, TUI a dalších) na jednom místě, abyste pro konkrétní dovolenou našli tu nejvýhodnější.' },
    { q: 'Jak funguje porovnání dovolených na Kakapo.cz?', a: 'Kakapo.cz agreguje zájezdy a pobyty od českých cestovních kanceláří. U každé nabídky vidíte cenu, termín i stravu předem a můžete filtrovat podle destinace, ceny, délky i letiště. Rezervaci dokončíte přímo u pořádající cestovní kanceláře — cenu nijak nenavyšujeme.' },
    { q: 'Kolik stojí dovolená 2026?', a: `Cena dovolené 2026 závisí na destinaci, termínu, délce a stravě. Levnější pobyty u moře začínají už na pár tisících korun za osobu, all inclusive a exotika stojí více. Nejvýhodnější termíny najdete porovnáním nabídek a sledováním ${l('/last-minute/', 'last minute')} slev.` },
  ];
}

export function homeLd(faqs: Faq[]) {
  return graph([
    { '@type': 'WebSite', name: 'Kakapo.cz', url: SITE + '/', potentialAction: { '@type': 'SearchAction', target: SITE + '/zajezdy/?q={search_term_string}', 'query-input': 'required name=search_term_string' } },
    faqLd(faqs),
  ]);
}
