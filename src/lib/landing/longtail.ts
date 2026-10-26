// Port of Kakapo_Longtail_Landings: /{country}/{topic}/ and /{country}/{dest}/{topic}/ (controlled combinations).
import longtailConsts from '../../data/longtail-consts.json';
import { slugify } from '../helpers';
import { loadRegistry, isCountry, isDestination, countryLabel, destinationLabel, type Registry } from '../snapshots';
import { normalizeFilters, search } from '../search';
import { esc } from './util';
import { longtailTopic, type LongtailTopic } from './topics';
import { titleBudget } from './meta';
import type { Faq, Crumb } from './util';

const C = longtailConsts as { MIN_INDEX_RESULTS: number; MIN_DEST_RESULTS: number; TOPIC_SLUGS: string[]; DEST_TOPIC_SLUGS: string[]; PRIORITY_COUNTRIES: string[] };
export const MIN_INDEX_RESULTS = C.MIN_INDEX_RESULTS;
export const TOPIC_SLUGS = C.TOPIC_SLUGS;
export const DEST_TOPIC_SLUGS = C.DEST_TOPIC_SLUGS;
export const PRIORITY_COUNTRIES = C.PRIORITY_COUNTRIES;
export const existsTopic = (slug: string) => TOPIC_SLUGS.includes(slugify(slug));

export interface LongtailCtx {
  type: 'longtail'; filters: Record<string, any>; h1: string; title: string; description: string; path: string; canonical: string;
  breadcrumbs: Crumb[]; intro: string; seo_text: string; faqs: Faq[]; index_min: number; longtail: { topic: string; country: string; dest: string };
}

const lc = (s: string) => s.toLocaleLowerCase('cs');

function topicSpecific(topic: LongtailTopic, place: string): string {
  const slug = topic.slug;
  if (slug === 'levna-dovolena') return '<h2>Kdy hledat nejlevnější termíny</h2><p>U levnějších zájezdů se vyplatí porovnat více letišť, kratší i delší délku pobytu a méně exponované termíny mimo hlavní školní prázdniny. Nejnižší cena nemusí být nejlepší volba, pokud znamená horší polohu hotelu, slabší stravu nebo nepohodlné časy letů.</p>';
  if (slug === 'luxusni-dovolena') return '<h2>Co hlídat u luxusnějších hotelů</h2><p>U 5hvězdičkových hotelů porovnávejte nejen počet hvězdiček, ale také hodnocení, rozsah all inclusive služeb, typ pokoje, polohu u pláže a dostupné termíny. Rozdíl v ceně často dělá výhled, vybavení pokoje a konkrétní cestovní kancelář.</p>';
  if (slug === 'dovolena-letecky') return '<h2>Odletové letiště a časy letů</h2><p>U letecké dovolené porovnejte Prahu, Brno, Ostravu i další letiště, pokud jsou dostupná. Levnější termín může mít méně praktický čas odletu nebo návratu, proto je dobré sledovat cenu společně s délkou pobytu a transferem.</p>';
  if (topic.last_minute_airport) return `<h2>Jak vybírat last minute z ${esc(topic.airport_from)}</h2><p>U last minute nabídek je nejdůležitější rychle ověřit skutečnou dostupnost pokoje, přesné odletové letiště, časy letů a to, co je zahrnuté v ceně. Vyplatí se porovnat více hotelů najednou, protože u blízkých odletů se cena i dostupnost mění rychleji než u běžných termínů.</p>`;
  if (topic.airport_from) return `<h2>Proč porovnat odlety z ${esc(topic.airport_from)}</h2><p>Odletové letiště má vliv na cenu, dostupnost termínů i pohodlí celé cesty. U stejného hotelu se mohou nabídky s odletem z různých letišť lišit cenou, délkou pobytu, časy letů i dostupností pokojů, proto dává smysl filtrovat konkrétní letiště a porovnat více termínů.</p>`;
  if (slug === 'dovolena-s-detmi-all-inclusive') return '<h2>Proč u rodinné dovolené řešit all inclusive</h2><p>All inclusive pomáhá držet rozpočet a šetří čas během dne. U rodin ale nestačí hlídat jen stravu v ceně: důležitý je také pokoj, pozvolný vstup do moře, bazén, stín, délka transferu a časy letů.</p>';
  if (slug === 'levna-dovolena-s-detmi') return '<h2>Kde ušetřit, aniž by trpěl komfort rodiny</h2><p>Největší úsporu často přinese posun termínu mimo hlavní špičku, jiný den odletu nebo méně vyprodaná destinace. U levné rodinné dovolené ale vždy kontrolujte transfer, pokoj, pláž a stravu, protože právě tam se levná nabídka může prodražit.</p>';
  if (slug === 'piscita-plaz') return '<h2>Pláž a vstup do moře</h2><p>Písečná pláž je důležitá hlavně pro rodiny s dětmi a cestovatele, kteří chtějí pohodlné koupání. Před rezervací si ověřte vzdálenost hotelu od pláže, pozvolnost vstupu do moře a zda jsou lehátka nebo plážový servis v ceně.</p>';
  if (slug === 'aquapark') return '<h2>Aquapark, bazény a zábava v hotelu</h2><p>Hotely s aquaparkem se hodí hlavně pro rodiny, ale rozdíly mezi nimi jsou velké. Sledujte počet bazénů, tobogány, věková omezení, sezónní provoz vodních atrakcí a to, jestli je vstup do aquaparku zahrnutý v ceně pobytu.</p>';
  if (topic.sea_winter) return '<h2>Zimní únik za teplem</h2><p>U zimní dovolené u moře porovnávejte hlavně teplotu vody, délku letu, vítr, rozsah all inclusive a to, zda je destinace vhodná ke koupání nebo spíš k odpočinku a výletům. Dobře se vyplatí sledovat také vánoční, lednové a únorové termíny zvlášť.</p>';
  if (topic.sea_month) return `<h2>Moře, počasí a dostupnost v termínu</h2><p>${esc(topic.month)} je u řady destinací přechod mezi hlavní sezónou a zimní exotikou. Sledujte nejen cenu, ale i počasí, teplotu vody, časy letů a to, jestli konkrétní oblast ještě nabízí vhodné koupání.</p>`;
  if (topic.family_sea) return '<h2>Rodinný hotel u moře</h2><p>U rodinné dovolené u moře má praktická stránka větší váhu než samotná cena. Porovnejte pozvolný vstup do vody, délku transferu, velikost pokoje, stín, bazén, dětské menu a časy letů.</p>';
  if (topic.cheap_ai_sea) return '<h2>Jak najít nejnižší cenu bez špatného kompromisu</h2><p>U levné all inclusive dovolené u moře sledujte, co je skutečně v ceně: zavazadla, transfer, rozsah stravy, polohu hotelu a hodnocení z poslední sezóny. Nejnižší cena dává smysl jen tehdy, když neznamená horší pláž, noční přílet nebo výrazně slabší služby.</p>';
  if (topic.month) return `<h2>Počasí, obsazenost a ceny v termínu</h2><p>${esc(topic.month)} patří u řady destinací mezi žádané termíny, proto se vyplatí sledovat dostupnost průběžně. U výběru ${esc(place)} porovnejte nejen cenu, ale i délku pobytu, stravu, letiště a to, jestli jde o termín vhodný pro koupání, výlety nebo klidnější dovolenou mimo největší špičku.</p>`;
  return '';
}

/** Context of a longtail landing; null when the country/destination/topic is unknown. */
export function longtailContext(reg: Registry, countrySlugIn: string, destSlugIn: string, topicSlug: string, now?: any): LongtailCtx | null {
  const countrySlug = slugify(countrySlugIn); const destSlug = slugify(destSlugIn);
  const topic = existsTopic(topicSlug) ? longtailTopic(slugify(topicSlug), now) : null;
  if (!topic || !isCountry(reg, countrySlug)) return null;
  if (destSlug !== '' && !isDestination(reg, countrySlug, destSlug)) return null;
  const cLabel = countryLabel(reg, countrySlug);
  const place = destSlug !== '' ? destinationLabel(reg, countrySlug, destSlug) : cLabel;
  const filters: Record<string, any> = { country: countrySlug, ...topic.filters };
  if (destSlug !== '') filters.dest = destSlug;
  const path = `/${countrySlug}/${destSlug !== '' ? destSlug + '/' : ''}${topic.slug}/`;
  const titlePlace = destSlug !== '' ? `${place}, ${cLabel}` : cLabel;
  let h1: string; let core: string;
  if (topic.place_format) { h1 = topic.place_format.replace('%s', place).trim(); core = topic.place_format.replace('%s', titlePlace).trim(); }
  else { h1 = `${topic.h1_prefix} ${place}`.trim(); core = `${topic.title_prefix} ${titlePlace}`.trim(); }
  if (topic.airport_from) { h1 += ` z ${topic.airport_from}`; core += ` z ${topic.airport_from}`; }
  const isDest = destSlug !== '';
  const placeD = isDest ? `${place} v destinaci ${cLabel}` : cLabel;
  const placeP = isDest ? `${place} (${cLabel})` : cLabel;
  let description: string;
  if (topic.last_minute_airport) description = `Last minute ${placeD} s odletem z ${topic.airport_from}: porovnejte aktuální zájezdy, termíny, hotely a ceny od českých cestovních kanceláří.`;
  else if (topic.airport_from) description = `Dovolená ${placeD} s odletem z ${topic.airport_from}: porovnejte hotely, termíny, stravu, letiště a ceny od českých cestovních kanceláří.`;
  else description = `${topic.title_prefix} ${placeD}: porovnejte hotely, termíny, stravu, odlety a ceny od českých cestovních kanceláří.`;
  let intro: string;
  if (topic.last_minute_airport) intro = `Last minute ${placeP} z ${topic.airport_from} vybírejte podle aktuální ceny, nejbližšího odletu, délky pobytu, stravy a polohy hotelu. Na Kakapo.cz porovnáváme dostupné nabídky s odletem z letiště ${topic.airport_name}; rezervaci dokončíte přímo u partnera bez navýšení ceny.`;
  else if (topic.airport_from) intro = `Dovolená ${placeP} z ${topic.airport_from} vybírejte podle ceny, termínu, délky pobytu, stravy a polohy hotelu. Na Kakapo.cz porovnáváme aktuální nabídky s odletem z letiště ${topic.airport_name} na jednom místě; rezervaci dokončíte přímo u partnera bez navýšení ceny.`;
  else intro = `${topic.title_prefix} ${placeP} vybírejte podle ceny, termínu, délky pobytu, stravy a polohy hotelu. Na Kakapo.cz porovnáváme aktuální nabídky od cestovních kanceláří na jednom místě; rezervaci dokončíte přímo u partnera bez navýšení ceny.`;
  const tl = lc(topic.label);
  const seo = `<h2>Jak vybrat ${esc(tl)} ${esc(placeP)}</h2><p>Nejdřív porovnejte, co je v ceně: termín odletu, délku pobytu, typ pokoje, stravu, zavazadla a transfer z letiště. U stejného hotelu se může lišit cena podle cestovní kanceláře, letiště i přesného termínu, proto dává smysl sledovat konkrétní nabídky vedle sebe.</p>`
    + topicSpecific(topic, placeP)
    + '<h2>Co porovnat před rezervací</h2><ul><li>aktuální cenu za osobu a případnou cenu celkem,</li><li>stravu a rozsah služeb v hotelu,</li><li>odletové letiště, časy letů a délku transferu,</li><li>polohu hotelu vůči pláži, centru nebo výletům,</li><li>fotky, hvězdičky, hodnocení a dostupné termíny.</li></ul>'
    + `<h2>Související výběr</h2><p>Výběr můžete rozšířit také přes <a href="/${esc(countrySlug)}/">dovolenou ${esc(cLabel)}</a>, <a href="/all-inclusive/">all inclusive dovolenou</a>, <a href="/last-minute/">last minute zájezdy</a> nebo hlavní přehled <a href="/zajezdy/">zájezdů</a>.</p>`;
  const crumbs: Crumb[] = [{ label: 'Domů', url: '/' }, { label: cLabel, url: `/${countrySlug}/` }];
  if (isDest) crumbs.push({ label: place, url: `/${countrySlug}/${destSlug}/` });
  crumbs.push({ label: topic.label, url: '' });
  return {
    type: 'longtail', filters, h1, title: titleBudget(core), description, path, canonical: path, breadcrumbs: crumbs, intro, seo_text: seo,
    faqs: [
      { q: `Kdy rezervovat ${tl} ${placeP}?`, a: 'Pokud chcete konkrétní hotel nebo prázdninový termín, rezervujte s předstihem. Pokud jste flexibilní v datu, letišti a hotelu, vyplatí se sledovat i last minute nabídky.' },
      { q: 'Co je u výběru nejdůležitější?', a: 'Vedle ceny sledujte termín, délku pobytu, typ stravy, polohu hotelu, odletové letiště, transfer a aktuální dostupnost pokojů.' },
      { q: 'Prodává Kakapo.cz zájezdy přímo?', a: 'Ne. Kakapo.cz nabídky porovnává. Rezervaci dokončíte vždy přímo u cestovní kanceláře nebo partnera, který zájezd pořádá.' },
    ],
    index_min: topic.index_min ?? MIN_INDEX_RESULTS, longtail: { topic: topic.slug, country: countrySlug, dest: destSlug },
  };
}

async function countResults(db: D1Database, filters: Record<string, any>): Promise<number> {
  return (await search(db, normalizeFilters(filters))).total;
}
export async function hasEnoughResults(db: D1Database, ctx: { filters: Record<string, any>; index_min?: number }): Promise<boolean> {
  return (await countResults(db, ctx.filters)) >= (ctx.index_min ?? MIN_INDEX_RESULTS);
}

/** Longtail landings that belong in the sitemap (priority countries × topics with enough results). */
export async function longtailSitemapLandings(db: D1Database): Promise<Array<{ path: string; label: string; cnt: number }>> {
  const reg = await loadRegistry(db); const out: Array<{ path: string; label: string; cnt: number }> = [];
  for (const country of PRIORITY_COUNTRIES) {
    if (!reg.countries[country] || reg.countries[country]!.cnt < MIN_INDEX_RESULTS) continue;
    for (const t of TOPIC_SLUGS) {
      const ctx = longtailContext(reg, country, '', t); if (!ctx) continue;
      const n = await countResults(db, ctx.filters); if (n >= ctx.index_min) out.push({ path: ctx.path, label: ctx.h1, cnt: n });
    }
    const dests = Object.entries(reg.destinations[country] ?? {}).sort((a, b) => b[1].cnt - a[1].cnt).slice(0, 12);
    for (const [dest, d] of dests) {
      if (d.cnt < C.MIN_DEST_RESULTS) continue;
      for (const t of DEST_TOPIC_SLUGS) {
        const ctx = longtailContext(reg, country, dest, t); if (!ctx) continue;
        const n = await countResults(db, ctx.filters); if (n >= ctx.index_min) out.push({ path: ctx.path, label: ctx.h1, cnt: n });
      }
    }
  }
  return out;
}
