// Port of Kakapo_Landing_Pages::context() — landing context (filters, texts, breadcrumbs, FAQs) for every listing page type.
import { swapYear, swapYearDeep, yearForPath } from '../year';
import priority from './priority-countries.json';
import { MEAL_LABELS, slugify } from '../helpers';
import { loadRegistry, countryLabel, destinationLabel, airportLabel, type Registry } from '../snapshots';
import { esc, lower, remember, FACT_TTL_MS, type Faq, type Crumb } from './util';
import { pragueNow } from './dates';
import * as facts from './facts';
import { climateSection } from './climate';
import { hasEnoughResults, longtailContext } from './longtail';
import { getTopic, partnerLinksBlock, sectionsToHtml, type Topic } from './topics';

const GENERIC_DESTINATIONS: Record<string, string> = { pobrezi: 'pobřeží', vnitrozemi: 'vnitrozemí', pevnina: 'pevnina', 'jizni-pobrezi': 'jižní pobřeží', 'baltske-more': 'Baltské moře' };

export interface LandingVars { country?: string; dest?: string; flag?: string; meal?: string; airport?: string; topic?: string; ltopic?: string; partner?: string }
export interface LandingCtx {
  type: string; filters: Record<string, any>; h1: string; title: string; description: string; path: string; canonical: string;
  breadcrumbs: Crumb[]; intro: string; seo_text: string; faqs: Faq[]; index_min?: number;
  /** Hydrated topic definition (topic/partner pages): eyebrow, hero_image, CTAs, cards, sections… */
  topic?: Topic; longtail?: { topic: string; country: string; dest: string };
}

const ucfirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const a = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`;

/** Stored FAQs (override): question + answer required, max 8, markup stripped from the question. */
export function normalizeFaqs(input: unknown): Faq[] {
  const out: Faq[] = [];
  if (!Array.isArray(input)) return out;
  for (const f of input) {
    if (!f || typeof f !== 'object') continue;
    const q = String((f as any).q ?? '').replace(/<[^>]*>/g, '').trim();
    const ans = String((f as any).a ?? '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
    if (q === '' || ans.replace(/<[^>]*>/g, '').trim() === '') continue;
    out.push({ q, a: ans });
    if (out.length >= 8) break;
  }
  return out;
}

async function longtailLink(db: D1Database, reg: Registry, country: string, dest: string, topic: string): Promise<{ label: string; url: string } | null> {
  const ctx = longtailContext(reg, country, dest, topic);
  if (!ctx) return null;
  const ok = await remember(`ltlink:${ctx.path}`, FACT_TTL_MS, () => hasEnoughResults(db, ctx));
  return ok ? { label: ctx.h1, url: ctx.path } : null;
}
function linkList(links: Array<{ label: string; url: string } | null>): string {
  const out: string[] = [];
  for (const l of links) { if (!l || !l.label || !l.url) continue; out.push(a(l.url, l.label)); if (out.length >= 8) break; }
  return out.join(', ');
}

async function countrySeoText(db: D1Database, reg: Registry, country: string, label: string): Promise<string> {
  const links = linkList(await Promise.all(['all-inclusive', 'last-minute', 'dovolena-s-detmi', 'dovolena-u-more', 'levna-dovolena', 'odlet-z-prahy', 'dovolena-zari', 'dovolena-prosinec'].map((t) => longtailLink(db, reg, country, '', t))));
  const f = await facts.paragraph(db, country, '', 'Dovolená ' + label);
  const rows = facts.destinationTable(reg, country, 6);
  let out = f;
  if (rows) out += `<h2>Kam konkrétně v destinaci ${esc(label)}</h2>${rows}`;
  out += '<h2>Na co si dát pozor</h2><p>Cenu porovnávejte vždy spolu s termínem, stravou, odletovým letištěm a polohou hotelu — stejná částka znamená u dvou nabídek často jiný pobyt. U prázdninových termínů se vyplatí rezervovat dřív, u volnějšího plánu naopak sledovat last minute.</p>';
  if (links) out += `<h2>Související výběr</h2><p>${links}.</p>`;
  return out;
}
async function destinationSeoText(db: D1Database, reg: Registry, country: string, dest: string, cLabel: string, dLabel: string): Promise<string> {
  const links = linkList([...(await Promise.all(['all-inclusive', 'last-minute', 'dovolena-s-detmi', 'dovolena-u-more', 'levna-dovolena', 'odlet-z-prahy'].map((t) => longtailLink(db, reg, country, dest, t)))), { label: 'Dovolená ' + cLabel, url: `/${country}/` }]);
  let out = await facts.paragraph(db, country, dest, esc(dLabel));
  if (out === '') out = `<h2>${esc(dLabel)}</h2><p>${esc(dLabel)} patří do destinace ${esc(cLabel)}. Nabídky porovnáváme napříč českými cestovkami, cenu uvádíme za osobu včetně dopravy podle konkrétního termínu.</p>`;
  out += '<h2>Na co si dát pozor</h2><p>U jedné oblasti se hotely liší hlavně polohou a vzdáleností od pláže či centra — porovnejte ji společně se stravou, termínem a odletovým letištěm, protože právě tyhle čtyři věci dělají mezi podobně drahými nabídkami největší rozdíl.</p>';
  if (links) out += `<h2>Související výběr</h2><p>${links}.</p>`;
  return out;
}

const GENERAL_SEO = `<h2>Jak porovnat zájezdy na jednom místě</h2><p>U zájezdů se nevyplatí rozhodovat jen podle nejnižší ceny. Sledujte termín, délku pobytu, stravu, odletové letiště, polohu hotelu, hodnocení a to, u které cestovní kanceláře rezervaci dokončíte. Kakapo.cz vám pomáhá porovnat nabídky vedle sebe a rychle zúžit výběr podle toho, co je pro vaši dovolenou opravdu důležité.</p><h2>Nejčastější způsoby výběru</h2><table><tbody><tr><th>Hledáte</th><th>Začněte zde</th></tr><tr><td>nejnižší cenu</td><td><a href="/levna-dovolena/">levná dovolená</a> nebo <a href="/last-minute/">last minute</a></td></tr><tr><td>pobyt bez starostí</td><td><a href="/all-inclusive/">all inclusive dovolená</a></td></tr><tr><td>rodinný pobyt</td><td><a href="/dovolena-s-detmi/">dovolená s dětmi</a></td></tr><tr><td>moře a pláž</td><td><a href="/dovolena-u-more/">dovolená u moře</a></td></tr></tbody></table><h2>Co hlídat před kliknutím na nabídku</h2><ul><li>zda je cena za osobu nebo za celý pobyt,</li><li>co přesně obsahuje strava a doprava,</li><li>časy odletu a návratu,</li><li>vzdálenost hotelu od pláže nebo centra,</li><li>aktuální dostupnost konkrétního termínu.</li></ul><h2>Související výběr zájezdů</h2><p><a href="/last-minute-all-inclusive/">Last minute all inclusive</a>, <a href="/super-last-minute-odlet-zitra/">super last minute odlet zítra</a>, <a href="/egypt-last-minute-all-inclusive/">Egypt last minute all inclusive</a> a <a href="/turecko-all-inclusive/">Turecko all inclusive</a>.</p>`;
const GENERAL_FAQS: Faq[] = [
  { q: 'Jak Kakapo.cz porovnává zájezdy?', a: 'Kakapo.cz agreguje nabídky od partnerů a cestovních kanceláří. U nabídek vidíte cenu, termín, stravu a další parametry; rezervaci dokončíte přímo u pořadatele.' },
  { q: 'Platím na Kakapo.cz něco navíc?', a: 'Ne. Kakapo.cz je srovnávač. Po kliknutí na nabídku pokračujete k partnerovi, kde vidíte finální podmínky rezervace.' },
  { q: 'Podle čeho zájezd vybrat?', a: 'Vedle ceny sledujte termín, stravu, polohu hotelu, odletové letiště, transfer, hodnocení a aktuální dostupnost.' },
];
function flagSeo(isLast: boolean): string {
  return isLast
    ? '<h2>Jak vybírat last minute dovolenou</h2><p>Last minute dovolená se vyplatí hlavně tehdy, když jste flexibilní v destinaci, hotelu, letišti a termínu. Nabídky s blízkým odletem se mění rychleji než běžné termíny, proto je důležité kontrolovat reálnou dostupnost pokoje, časy letů a to, co je zahrnuté v ceně.</p><h2>Kdy může být last minute výhodné</h2><ul><li>můžete odletět během několika dnů,</li><li>neřešíte jediný konkrétní hotel,</li><li>porovnáte více zemí najednou,</li><li>jste ochotní přizpůsobit odletové letiště,</li><li>chcete hlavně poměr cena/výkon.</li></ul><h2>Související výběr</h2><p><a href="/last-minute-all-inclusive/">Last minute all inclusive</a>, <a href="/super-last-minute-odlet-zitra/">super last minute odlet zítra</a>, <a href="/egypt-last-minute-all-inclusive/">Egypt last minute all inclusive</a>, <a href="/last-minute-z-prahy/">last minute z Prahy</a> a <a href="/last-minute-z-brna/">last minute z Brna</a>.</p>'
    : '<h2>Proč rezervovat first minute dovolenou</h2><p>First minute se hodí ve chvíli, kdy chcete konkrétní hotel, prázdninový termín, rodinný pokoj nebo širší výběr odletů. Nejde vždy o absolutně nejnižší cenu, ale často o lepší dostupnost dobrých hotelů a pokojů, které se později vyprodají.</p><h2>Kdy zvolit first minute</h2><ul><li>plánujete letní prázdniny nebo svátky,</li><li>cestujete s dětmi a potřebujete konkrétní pokoj,</li><li>chcete lepší výběr letovisek a hotelů,</li><li>nechcete čekat na nejistý last minute,</li><li>řešíte odlet z konkrétního letiště.</li></ul><h2>Související výběr</h2><p><a href="/dovolena-s-detmi/">Dovolená s dětmi</a>, <a href="/all-inclusive/">all inclusive</a>, <a href="/dovolena-u-more/">dovolená u moře</a>.</p>';
}
const flagFaqs = (isLast: boolean): Faq[] => isLast
  ? [{ q: 'Je last minute vždy nejlevnější?', a: 'Ne vždy. Last minute může být výhodný při flexibilitě, ale u prázdninových termínů a oblíbených hotelů může být lepší rezervovat dříve.' }, { q: 'Jak rychle se last minute nabídky mění?', a: 'U blízkých odletů se cena i dostupnost mění často. Před rezervací vždy zkontrolujte termín, letiště, pokoj a rozsah služeb.' }]
  : [{ q: 'Kdy se vyplatí first minute?', a: 'First minute se vyplatí pro konkrétní hotel, rodinný pokoj, prázdninový termín nebo odlet z určitého letiště.' }, { q: 'Je first minute levnější než last minute?', a: 'Někdy ano, někdy ne. First minute je hlavně o větším výběru a jistotě, last minute o flexibilitě a rychlém rozhodnutí.' }];
function mealSeo(meal: string, label: string): string {
  const isAi = meal === 'all-inclusive';
  return `<h2>Jak vybrat dovolenou ${esc(lower(label))}</h2>`
    + (isAi
      ? '<p>All inclusive dovolená je vhodná pro cestovatele, kteří chtějí mít jídlo, nápoje a část služeb zahrnuté v ceně. Nejvíc dává smysl u rodin s dětmi, resortových pobytů a destinací, kde by samostatné stravování na místě výrazně zvyšovalo rozpočet.</p>'
      : '<p>Typ stravy vybírejte podle toho, jak chcete trávit den. Snídaně nebo polopenze dávají smysl, pokud plánujete výlety a nechcete být celý den v hotelu. Plná penze nebo all inclusive jsou praktičtější pro resortový pobyt a jasnější rozpočet.</p>')
    + '<h2>Co porovnat u stravy</h2><ul><li>přesný rozsah služeb v ceně,</li><li>nápoje, snacky a časy podávání jídel,</li><li>vhodnost pro děti nebo dietní omezení,</li><li>dostupnost restaurací mimo hotel,</li><li>rozdíl ceny proti jiné variantě stravy.</li></ul>'
    + '<h2>Související výběr</h2><p><a href="/last-minute-all-inclusive/">Last minute all inclusive</a>, <a href="/dovolena-s-detmi-all-inclusive/">dovolená s dětmi all inclusive</a>, <a href="/turecko-all-inclusive/">Turecko all inclusive</a>, <a href="/egypt-letecky-all-inclusive/">Egypt letecky all inclusive</a>, <a href="/albanie-all-inclusive-letecky/">Albánie all inclusive letecky</a>, <a href="/egypt/all-inclusive/">Egypt all inclusive</a> a <a href="/recko/all-inclusive/">Řecko all inclusive</a>.</p>';
}
const mealFaqs = (label: string): Faq[] => [
  { q: `Co znamená ${lower(label)}?`, a: 'Jde o typ stravy zahrnuté v ceně pobytu. Přesný rozsah se může lišit podle hotelu a cestovní kanceláře, proto je dobré číst detail nabídky.' },
  { q: 'Kdy se vyplatí all inclusive?', a: 'All inclusive se nejvíc vyplatí u resortových pobytů, rodin s dětmi a destinací, kde chcete mít většinu výdajů za jídlo a nápoje pod kontrolou.' },
];
const airportSeo = (slug: string, label: string) => `<h2>Jak vybírat dovolenou s odletem z letiště ${esc(label)}</h2><p>Odletové letiště ovlivňuje nejen pohodlí cesty, ale i cenu, délku pobytu a dostupné termíny. U stejného hotelu se může nabídka lišit podle toho, odkud letíte, proto dává smysl porovnat cenu společně s časy letů, zavazadly, transferem a návratem.</p><h2>Co zkontrolovat u odletu</h2><ul><li>čas odletu a návratu,</li><li>zda jsou zavazadla zahrnutá v ceně,</li><li>délku transferu po příletu,</li><li>celkový počet nocí v hotelu,</li><li>rozdíl ceny proti jinému letišti.</li></ul><h2>Související výběr</h2><p><a href="/last-minute-z-${esc(slug)}/">Last minute z ${esc(label)}</a>, <a href="/dovolena-letecky/">dovolená letecky</a>, <a href="/last-minute/">last minute dovolená</a>.</p>`;
const airportFaqs = (): Faq[] => [
  { q: 'Vyplatí se porovnat i jiné odletové letiště?', a: 'Ano. Jiný odlet může znamenat nižší cenu, lepší čas letu nebo dostupnější termín, ale vždy zvažte i dopravu na letiště.' },
  { q: 'Co kontrolovat u letu?', a: 'Hlídejte čas odletu a návratu, zavazadla, délku pobytu v hotelu, transfer a případné změny v pokynech cestovní kanceláře.' },
];
async function countryFaqs(db: D1Database, label: string, country: string): Promise<Faq[]> {
  const f = country ? await facts.faqs(db, country, '', 'Dovolená ' + label) : [];
  f.push({ q: 'Je lepší all inclusive, nebo polopenze?', a: 'All inclusive se hodí pro resortový pobyt a rodiny s dětmi. Polopenze nebo snídaně dávají větší volnost, pokud plánujete výlety a chcete trávit čas mimo hotel.' });
  if (f.length < 3) f.push({ q: `Jak vybrat dovolenou ${label}?`, a: 'Začněte termínem, rozpočtem a typem pobytu. Potom porovnejte hotel, stravu, polohu, odletové letiště, transfer a aktuální dostupnost konkrétní nabídky.' });
  return f;
}
async function destinationFaqs(db: D1Database, cLabel: string, dLabel: string, country: string, dest: string): Promise<Faq[]> {
  const f = country && dest ? await facts.faqs(db, country, dest, dLabel) : [];
  if (f.length < 3) f.push({ q: 'Co porovnat před rezervací?', a: 'Zkontrolujte polohu hotelu, vzdálenost od pláže, transfer, stravu, časy letů, hodnocení a to, co je zahrnuté v ceně.' });
  if (f.length < 3) f.push({ q: `Pro koho je vhodná dovolená ${dLabel}?`, a: `${dLabel} v destinaci ${cLabel} vybírejte podle typu hotelu, pláže, stravy a polohy.` });
  return f;
}

type Priority = { title: string; description: string; intro: string; focus: string; links: string[][] };
function priorityContext(country: string, label: string): Partial<LandingCtx> | null {
  const d = (priority as Record<string, Priority>)[country];
  if (!d) return null;
  const links = d.links.map((l) => a(l[1]!, l[0]!)).join(', ');
  return {
    title: d.title, description: d.description, intro: d.intro,
    seo_text: `<h2>Jak vybrat dovolenou ${esc(label)}</h2><p>${esc(d.focus)}</p><h2>Co porovnat před rezervací</h2><ul><li>termín, cenu a délku pobytu,</li><li>stravu a služby zahrnuté v ceně,</li><li>polohu hotelu a typ pláže,</li><li>odletové letiště a časy letů,</li><li>aktuální dostupnost pokojů a recenze.</li></ul><h2>Související výběr</h2><p>${links}.</p>`,
    faqs: [
      { q: `Kdy rezervovat dovolenou ${label}?`, a: 'Pokud chcete konkrétní hotel nebo prázdninový termín, rezervujte s předstihem. Pokud jste flexibilní v letišti a hotelu, vyplatí se sledovat i last minute nabídky.' },
      { q: 'Co je při výběru nejdůležitější?', a: 'Vedle ceny porovnejte polohu hotelu, pláž, stravu, transfer, časy letů, aktuální recenze a dostupné termíny.' },
    ],
  };
}

const CONTEXT_LINK_BLOCKS: Record<string, string> = {
  '/zajezdy/': '<h2>Související výběr zájezdů</h2><p><a href="/last-minute-all-inclusive/">Last minute all inclusive</a>, <a href="/dovolena-u-more-all-inclusive/">dovolená u moře all inclusive</a>, <a href="/super-last-minute-odlet-zitra/">super last minute odlet zítra</a>, <a href="/egypt-last-minute-all-inclusive/">Egypt last minute all inclusive</a>, <a href="/recko-all-inclusive/">Řecko all inclusive</a> a <a href="/turecko-all-inclusive/">Turecko all inclusive</a>.</p>',
  '/last-minute/': '<h2>Související last minute výběr</h2><p><a href="/last-minute-all-inclusive/">Last minute all inclusive</a>, <a href="/last-minute-all-inclusive-z-prahy/">last minute all inclusive z Prahy</a>, <a href="/last-minute-all-inclusive-z-brna/">last minute all inclusive z Brna</a>, <a href="/super-last-minute-odlet-zitra/">super last minute odlet zítra</a>, <a href="/egypt-last-minute-all-inclusive/">Egypt last minute all inclusive</a> a <a href="/recko-last-minute-all-inclusive/">Řecko last minute all inclusive</a>.</p>',
  '/all-inclusive/': '<h2>Související all inclusive výběr</h2><p><a href="/dovolena-u-more-all-inclusive/">Dovolená u moře all inclusive</a>, <a href="/levna-dovolena-u-more-all-inclusive/">levná dovolená u moře all inclusive</a>, <a href="/dovolena-s-detmi-u-more-all-inclusive/">dovolená s dětmi u moře all inclusive</a>, <a href="/last-minute-all-inclusive/">last minute all inclusive</a>, <a href="/recko-all-inclusive/">Řecko all inclusive</a>, <a href="/turecko-all-inclusive/">Turecko all inclusive</a>, <a href="/egypt-letecky-all-inclusive/">Egypt letecky all inclusive</a> a <a href="/albanie-all-inclusive-letecky/">Albánie all inclusive letecky</a>.</p>',
  '/dovolena-u-more/': '<h2>Související dovolená u moře</h2><p><a href="/dovolena-u-more-all-inclusive/">Dovolená u moře all inclusive</a>, <a href="/kam-v-srpnu-k-mori/">kam v srpnu k moři</a>, <a href="/kam-v-zari-k-mori/">kam v září k moři</a>, <a href="/chorvatsko-apartmany-u-more/">Chorvatsko apartmány u moře</a>, <a href="/turecko-all-inclusive/">Turecko all inclusive</a>, <a href="/egypt-last-minute-all-inclusive/">Egypt last minute all inclusive</a> a <a href="/last-minute-all-inclusive/">last minute all inclusive</a>.</p>',
};
function appendContextLinks(seo: string, path: string): string {
  const block = CONTEXT_LINK_BLOCKS[path];
  if (!block) return seo;
  if (seo !== '' && seo.includes('last-minute-all-inclusive')) return seo;
  return seo + block;
}

/** Hand-written overrides from editorial_overrides (kind='landing', key=path). Legacy: /dovolena/ texts apply to /zajezdy/. */
export async function loadOverrides(db: D1Database, path: string): Promise<Record<string, string>> {
  const q = async (key: string) => Object.fromEntries((await db.prepare("SELECT field, value FROM editorial_overrides WHERE kind = 'landing' AND key = ?").bind(key).all<{ field: string; value: string }>()).results.map((r) => [r.field, r.value]));
  let t = await q(path);
  if (!Object.keys(t).length && path === '/zajezdy/') t = await q('/dovolena/');
  return t;
}

/**
 * Landing context. `page`: search | flag | meal | country | airport | topic | longtail (partner pages are topics).
 * Returns null when the topic/longtail combination does not exist.
 */
export async function landingContext(db: D1Database, page: string, vars: LandingVars): Promise<LandingCtx | null> {
  const reg = await loadRegistry(db);
  const ctx: LandingCtx = {
    type: page, filters: {}, h1: 'Zájezdy', title: 'Zájezdy — porovnání nabídek cestovních kanceláří | Kakapo.cz',
    description: 'Porovnejte zájezdy od českých cestovních kanceláří na jednom místě — termíny, stravu i ceny. Rezervace vždy přímo u pořadatele.',
    path: '/zajezdy/', canonical: '', breadcrumbs: [{ label: 'Domů', url: '/' }], intro: '', seo_text: '', faqs: [],
  };
  const year = pragueNow().y;

  switch (page) {
    case 'search': ctx.breadcrumbs.push({ label: 'Zájezdy', url: '' }); break;
    case 'flag': {
      const flag = vars.flag ?? '';
      if (flag === 'zlevneno') {
        Object.assign(ctx, {
          filters: { flag: 'zlevneno', sort: 'drop' }, h1: 'Zlevněná dovolená', title: 'Zlevněné zájezdy — reálné poklesy cen | Kakapo.cz',
          description: 'Sledujeme ceny hotelů denně napříč cestovkami. Tady jsou zájezdy, které za poslední týden skutečně zlevnily — žádné vymyšlené slevy.',
          intro: 'Každý den sledujeme nejnižší cenu každého hotelu napříč cestovními kancelářemi. V tomto výběru jsou jen hotely, jejichž cena za poslední týden reálně klesla — nejde o marketingové „slevy" z ceníků, ale o skutečné poklesy, které jsme naměřili.',
          path: '/zlevneno/', index_min: 9999,
        });
        ctx.breadcrumbs.push({ label: 'Zlevněno', url: '' });
        break;
      }
      const label = flag === 'last-minute' ? 'Last minute' : 'First minute';
      Object.assign(ctx, {
        filters: { flag }, h1: `${label} dovolená`, title: `${label} dovolená — akční zájezdy | Kakapo.cz`,
        description: flag === 'last-minute' ? 'Last minute zájezdy s odletem v nejbližších dnech. Porovnejte akční ceny od českých CK a ušetřete.' : 'First minute dovolená s předstihem — nejlepší výběr hotelů a termínů za výhodné ceny.',
        path: `/${flag}/`,
      });
      ctx.breadcrumbs.push({ label, url: '' });
      break;
    }
    case 'meal': {
      const meal = vars.meal ?? ''; const label = MEAL_LABELS[meal] ?? ucfirst(meal);
      ctx.filters = { meal: [meal] }; ctx.h1 = 'Dovolená ' + lower(label);
      if (meal === 'all-inclusive') ctx.h1 = 'All inclusive dovolená';
      ctx.title = `${ctx.h1} — srovnání zájezdů | Kakapo.cz`;
      ctx.description = `Zájezdy se stravou ${lower(label)} od českých cestovních kanceláří. Porovnejte ceny a termíny.`;
      ctx.path = `/${meal}/`; ctx.breadcrumbs.push({ label, url: '' });
      break;
    }
    case 'country': {
      const country = vars.country ?? ''; const label = countryLabel(reg, country);
      ctx.filters = { country }; ctx.h1 = 'Dovolená ' + label; ctx.title = `Dovolená ${label} — zájezdy a ceny | Kakapo.cz`;
      ctx.description = `Zájezdy do destinace ${label} od českých CK. Porovnejte hotely, termíny a ceny na jednom místě.`;
      ctx.path = `/${country}/`;
      ctx.breadcrumbs.push({ label, url: vars.dest ? `/${country}/` : '' });
      if (country === 'albanie') {
        ctx.title = 'Albánie dovolená 2026 — zájezdy, hotely a ceny | Kakapo.cz';
        ctx.description = 'Albánie dovolená u moře: porovnejte hotely, termíny, stravu, odlety a ceny od českých cestovních kanceláří.';
        ctx.intro = 'Albánie patří mezi rychle rostoucí destinace pro dovolenou u moře. Nabízí pláže, dostupnější ceny a kombinaci hotelů pro páry i rodiny. Na Kakapo.cz porovnáte aktuální zájezdy podle ceny, termínu, stravy, letiště a polohy hotelu.';
        ctx.seo_text = '<h2>Jak vybrat dovolenou v Albánii</h2><p>U Albánie porovnejte hlavně oblast, typ pláže, vzdálenost hotelu od moře, stravu a dostupné odlety. Levnější nabídka může být výhodná, pokud má rozumnou polohu a dobré časy letů; u rodinné dovolené sledujte také transfer, pokoj a vstup do moře.</p><h2>Co si pohlídat před rezervací</h2><ul><li>konkrétní letovisko a charakter pláže,</li><li>stravu v ceně a služby hotelu,</li><li>odletové letiště a časy letů,</li><li>délku transferu z letiště,</li><li>aktuální recenze a fotky hotelu.</li></ul><h2>Související výběr</h2><p>Pokračovat můžete přes <a href="/albanie/all-inclusive/">Albánii all inclusive</a>, <a href="/albanie/dovolena-u-more/">dovolenou u moře v Albánii</a> nebo <a href="/albanie/levna-dovolena/">levnou dovolenou v Albánii</a>.</p>';
        ctx.faqs = [{ q: 'Pro koho je dovolená v Albánii vhodná?', a: 'Albánie se hodí pro cestovatele, kteří chtějí moře, zajímavé ceny a méně okoukanou destinaci. Při výběru hotelu sledujte hlavně oblast, pláž, stravu a transfer.' }, { q: 'Je Albánie vhodná pro rodiny s dětmi?', a: 'Ano, ale vyplatí se vybírat konkrétní hotel a pláž pečlivě. Důležitý je pozvolný vstup do moře, délka transferu, typ pokoje a služby hotelu.' }];
      }
      if (country === 'kapverdy' || country === 'kapverdske-ostrovy') {
        ctx.h1 = 'Kapverdy dovolená'; ctx.title = 'Kapverdy dovolená 2026 — zájezdy, hotely a ceny | Kakapo.cz';
        ctx.description = 'Kapverdy dovolená u oceánu: porovnejte hotely, all inclusive, termíny, odlety a ceny od českých cestovních kanceláří.';
        ctx.intro = 'Kapverdy, tedy Kapverdské ostrovy, jsou oblíbená dovolená u oceánu s teplem i mimo evropské léto. Porovnejte aktuální zájezdy podle ceny, termínu, stravy, odletového letiště a polohy hotelu.';
        ctx.seo_text = `<h2>Jak vybrat dovolenou na Kapverdách</h2><p>U Kapverd porovnejte hlavně ostrov, polohu hotelu, typ pláže, vítr, stravu a termín. Dovolená tu dává smysl pro páry i cestovatele, kteří chtějí teplo mimo hlavní evropskou sezónu. U resortů se vyplatí zkontrolovat rozsah all inclusive a vzdálenost od pláže.</p><h2>Co si pohlídat před rezervací</h2><ul><li>konkrétní ostrov a charakter pláže,</li><li>větrnost a vhodnost pro koupání,</li><li>rozsah all inclusive služeb,</li><li>odletové letiště a délku letu,</li><li>aktuální dostupnost pokojů a termínů.</li></ul><h2>Související výběr</h2><p>Pokračovat můžete přes <a href="/${country}/all-inclusive/">Kapverdy all inclusive</a>, <a href="/${country}/dovolena-u-more/">dovolenou u moře na Kapverdách</a> nebo <a href="/${country}/dovolena-prosinec/">Kapverdy v prosinci</a>.</p>`;
        ctx.faqs = [{ q: 'Jsou Kapverdy a Kapverdské ostrovy totéž?', a: 'Ano. V češtině se používá kratší název Kapverdy i plný název Kapverdské ostrovy.' }, { q: 'Kdy jet na Kapverdy?', a: 'Kapverdy jsou vhodné i mimo evropské léto. Při výběru termínu sledujte počasí, vítr, typ pláže a dostupnost konkrétních hotelů.' }];
      }
      const pc = priorityContext(country, label);
      if (pc) Object.assign(ctx, pc);
      if (vars.dest) {
        // names like "Vnitrozemí" / "Pobřeží" repeat across countries: without the country the title and H1 say nothing and collide
        const rawLabel = destinationLabel(reg, country, vars.dest);
        const dLabel = GENERIC_DESTINATIONS[vars.dest] ? `${label} – ${GENERIC_DESTINATIONS[vars.dest]}` : rawLabel;
        ctx.filters.dest = vars.dest; ctx.h1 = 'Dovolená ' + dLabel; ctx.title = `Dovolená ${dLabel} 2026 — zájezdy, hotely a ceny | Kakapo.cz`;
        ctx.description = `Dovolená ${dLabel} (${label}): porovnejte hotely, termíny, stravu, odlety a ceny od českých cestovních kanceláří.`;
        ctx.intro = `Plánujete dovolenou v destinaci ${dLabel} (${label})? Porovnejte nabídky hotelů a zájezdů od prověřených českých cestovních kanceláří na jednom místě — u každé vidíte cenu, termín i stravu předem a rezervaci dokončíte přímo u pořadatele, bez příplatků.`;
        ctx.seo_text = await destinationSeoText(db, reg, country, vars.dest, label, dLabel);
        // sister site (same owner, Kenny 2. 11. 2026): one contextual link, never back from the target page
        if (country === 'slovensko' && vars.dest === 'vysoke-tatry') {
          ctx.seo_text += '<p>Hledáte místo zájezdu spíš víkend s wellness nebo pobyt na vlastní pěst? Tatranské hotely s vouchery od Zľavomatu a Adropu porovnává slovenský web <a href="https://kuzelnemiesta.sk/pobyty-vo-vysokych-tatrach/">Kúzelné miesta</a>.</p>';
        }
        ctx.faqs = await destinationFaqs(db, label, dLabel, country, vars.dest);
        ctx.path = `/${country}/${vars.dest}/`;
        ctx.breadcrumbs.push({ label: dLabel, url: '' });
      }
      break;
    }
    case 'airport': {
      const ap = vars.airport ?? ''; const label = airportLabel(reg, ap);
      ctx.filters = { airport: [ap] }; ctx.h1 = 'Dovolená s odletem z: ' + label; ctx.title = `Odlet z ${label} — zájezdy a dovolená ${year} | Kakapo.cz`;
      ctx.description = `Porovnejte zájezdy s odletem z letiště ${label}: ceny, termíny, stravu i destinace od českých cestovních kanceláří na jednom místě.`;
      ctx.path = `/odlet-z-${ap}/`; ctx.breadcrumbs.push({ label: 'Odlet z: ' + label, url: '' });
      break;
    }
    case 'topic': {
      const topic = await getTopic(db, vars.topic ?? '');
      if (topic) ctx.topic = topic;
      if (topic && topic.listing) {
        ctx.filters = topic.filters ?? {}; ctx.h1 = topic.h1; ctx.title = topic.title; ctx.description = topic.description; ctx.path = topic.path; ctx.intro = topic.intro;
        if (topic.index_min !== undefined) ctx.index_min = topic.index_min;
        const isCk = !!topic.partner_page;
        ctx.seo_text = (isCk ? '' : await facts.destinationAnswer(db, ctx.filters, topic.label ?? topic.h1 ?? '')) + sectionsToHtml(topic);
        ctx.faqs = [...(isCk ? [] : await facts.answerFaq(db, ctx.filters, topic.h1 ?? topic.label ?? '')), ...(topic.faqs ?? [])];
        ctx.breadcrumbs.push({ label: topic.label, url: '' });
      } else if (!topic) return null;
      break;
    }
    case 'longtail': {
      const l = longtailContext(reg, vars.country ?? '', vars.dest ?? '', vars.ltopic ?? '');
      if (!l) return null;
      Object.assign(ctx, l);
      break;
    }
  }

  // enrich_default_context
  if (!(ctx.seo_text && ctx.faqs.length)) {
    if (page === 'country' && !vars.dest) {
      const country = slugify(vars.country ?? ''); const label = countryLabel(reg, country);
      if (!ctx.seo_text) ctx.seo_text = await countrySeoText(db, reg, country, label);
      if (!ctx.faqs.length) ctx.faqs = await countryFaqs(db, label, country);
      if (!ctx.title.includes('2026')) ctx.title = `Dovolená ${label} 2026 — zájezdy, hotely a ceny | Kakapo.cz`;
    } else if (page === 'search') {
      if (!ctx.seo_text) ctx.seo_text = GENERAL_SEO;
      if (!ctx.faqs.length) ctx.faqs = GENERAL_FAQS;
    } else if (page === 'flag') {
      const last = vars.flag === 'last-minute';
      if (!ctx.seo_text) ctx.seo_text = flagSeo(last);
      if (!ctx.faqs.length) ctx.faqs = flagFaqs(last);
    } else if (page === 'meal') {
      const meal = slugify(vars.meal ?? ''); const label = MEAL_LABELS[meal] ?? ucfirst(meal);
      if (!ctx.seo_text) ctx.seo_text = mealSeo(meal, label);
      if (!ctx.faqs.length) ctx.faqs = mealFaqs(label);
    } else if (page === 'airport') {
      const ap = slugify(vars.airport ?? ''); const label = airportLabel(reg, ap);
      if (!ctx.seo_text) ctx.seo_text = airportSeo(ap, label);
      if (!ctx.faqs.length) ctx.faqs = airportFaqs();
    }
  }

  // editorial overrides (they win over everything above; description is stored but the meta description ignores it on populated pages)
  const t = await loadOverrides(db, ctx.path);
  for (const k of ['h1', 'title', 'description', 'intro', 'seo_text'] as const) if (t[k]) ctx[k] = t[k]!;
  if (t.faqs_json) { try { const f = normalizeFaqs(JSON.parse(t.faqs_json)); if (f.length) ctx.faqs = f; } catch { /* ignore broken JSON */ } }

  // facts block "… v číslech" is appended even to overrides
  if ((page === 'country' || page === 'longtail') && slugify(vars.country ?? '') && !ctx.seo_text.includes('v číslech')) {
    const country = slugify(vars.country ?? ''); const dest = slugify(vars.dest ?? '');
    let label = dest ? destinationLabel(reg, country, dest) : 'Dovolená ' + countryLabel(reg, country);
    let range: facts.Range = {};
    if (ctx.filters.date_from && ctx.filters.date_to) { range = { date_from: String(ctx.filters.date_from), date_to: String(ctx.filters.date_to) }; label += ' — termíny v tomhle období'; }
    ctx.seo_text += await facts.paragraph(db, country, dest, label, range);
  }
  ctx.seo_text = appendContextLinks(ctx.seo_text, ctx.path);
  ctx.seo_text += partnerLinksBlock(ctx.path);
  ctx.seo_text += climateSection(ctx.path);
  ctx.canonical = ctx.path;
  // marketing year: dated windows (month topics) already carry their own year; everything else follows yearForPath()
  if (!ctx.filters.date_from) {
    const y = yearForPath(ctx.path);
    for (const k of ['h1', 'title', 'description', 'intro', 'seo_text'] as const) ctx[k] = swapYear(String(ctx[k] ?? ''), y);
    ctx.faqs = (ctx.faqs ?? []).map((f) => ({ q: swapYear(f.q, y), a: swapYear(f.a, y) }));
    if ((ctx as any).topic) (ctx as any).topic = swapYearDeep((ctx as any).topic, y);
  }
  return ctx;
}
