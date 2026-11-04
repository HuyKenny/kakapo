// Text/content logic of templates/product.php, products-hub.php, legal.php (ported verbatim where it is copy).
import { cleanProductTitle, formatPrice, nightsLabel, partnerLabel, slugify } from '../helpers';
import { getCategory } from './data';
import type { ProductRow } from './repo';

export interface Term { from?: string; to?: string; nights?: number; price: number; /** index in the ORIGINAL meta.terms (the go redirect indexes the unfiltered list) */ idx?: number }
export interface DetailModel {
  p: ProductRow; title: string; place: string; partner: string; plabel: string; cat: ReturnType<typeof getCategory>; type: string;
  images: string[]; terms: Term[]; hasTerms: boolean; rows: Term[]; goUrl: string; fitPoints: string[]; checkPoints: string[];
  related: Array<{ label: string; url: string }>; faqs: Array<{ q: string; a: string }>; descParagraphs: string[]; countrySlug: string;
}

const uniq = <T>(a: T[]) => [...new Set(a)];
const stripTags = (s: string) => s.replace(/<[^>]*>/g, '');

export function buildDetail(p: ProductRow, today: string): DetailModel {
  let images = p.images;
  if (!images.length && p.image_url) images = [p.image_url];
  const type = p.type;
  const cat = getCategory(type);
  const terms: Term[] = ((p.meta?.terms ?? []) as any[]).map((t, idx) => ({ ...t, idx })).filter((t) => t?.from && String(t.from) >= today);
  const hasTerms = terms.length > 0;
  const rows: Term[] = hasTerms ? terms : [{ from: p.date_from ?? '', to: p.date_to ?? '', nights: p.nights ?? 0, price: p.price }];
  const place = [p.destination, p.country].filter(Boolean).join(', ');
  const partner = p.partner_slug;
  const plabel = partnerLabel(partner);
  const title = cleanProductTitle(p.title, partner);
  let countrySlug = String(p.country_slug ?? '');
  if (countrySlug === '' && p.country) countrySlug = slugify(p.country);

  const fit: string[] = [];
  switch (type) {
    case 'plavby':
      fit.push('Pro cestovatele, kteří chtějí zažít cestu po vodě, výhledy z paluby a program bez složitého přesouvání mezi místy.', 'Dobrá volba, pokud chcete kratší plavbu, výlet lodí nebo ochutnávku plavebního stylu cestování.'); break;
    case 'poznavaci':
      fit.push('Pro cestovatele, kteří chtějí vidět více míst a mít program, dopravu nebo průvodce zajištěné předem.', 'Hodí se, pokud je pro vás důležitý jasný itinerář, poznávání a méně času stráveného plánováním detailů.'); break;
    case 'vzdelavaci':
      fit.push('Pro cestovatele, kteří chtějí z cesty získat hlubší kontext, odborný výklad nebo tematicky vedený program.', 'Hodí se, pokud je pro vás důležité nejen místo navštívit, ale také lépe pochopit jeho historii, kulturu nebo přírodu.'); break;
    case 'wellness':
      fit.push('Pro páry, přátele nebo rodinu, kteří hledají odpočinek, wellness služby a pobyt s jednoduchou rezervací.', 'Dává smysl, pokud chcete srovnat cenu, délku pobytu, stravu a rozsah relaxačních služeb.'); break;
    case 'eurovikendy':
      fit.push('Pro krátký únik do města, kde rozhoduje poloha, doprava a skutečný čas v destinaci.', 'Hodí se na prodloužený víkend, první návštěvu města nebo cestu s jasně daným rozpočtem.'); break;
    case 'lyzovani':
      fit.push('Pro zimní pobyt, kde je důležitá dostupnost sjezdovek, délka pobytu a služby po lyžování.', 'Dává smysl, pokud chcete rychle porovnat cenu, termín, stravu a pořadatele lyžařské nabídky.'); break;
    case 'zajezdy':
      fit.push('Pro pobytovou dovolenou, kde chcete mít dopředu jasno v ceně, termínu, stravě a pořadateli.', 'Hodí se, pokud porovnáváte dovolenou u moře a chcete rychle zjistit, zda nabídka odpovídá vašemu rozpočtu.'); break;
    default:
      fit.push('Pro cestovatele, kteří chtějí konkrétní nabídku rychle posoudit podle ceny, místa, termínu a pořadatele.', 'Dává smysl, pokud nechcete procházet desítky webů a chcete pokračovat až na ověřenou nabídku partnera.');
  }
  if (place !== '') fit.push(`Zajímavá volba pro lokalitu ${place}, pokud vám sedí termín, doprava a služby zahrnuté v ceně.`);
  if (p.nights) fit.push(`Délka ${nightsLabel(p.nights)} pomůže rychle odhadnout, zda nabídka odpovídá krátkému pobytu nebo delší cestě.`);
  const fitPoints = uniq(fit).slice(0, 4);

  const check = [
    'Před rezervací u partnera si ověřte aktuální dostupnost, konečnou cenu a případné povinné poplatky.',
    'Zkontrolujte, co přesně je zahrnuté v ceně, hlavně dopravu, stravu, vstupy, zavazadla a místní poplatky.',
  ];
  if (hasTerms) check.push('U termínů porovnejte nejen cenu, ale také čas odjezdu nebo odletu, návrat a délku pobytu.');
  else if (p.date_from) check.push('Ověřte, zda je uvedený termín stále dostupný a zda se vztahuje právě na vybranou variantu nabídky.');
  switch (type) {
    case 'plavby': check.push('U plaveb sledujte trasu, místo nalodění, servisní poplatky, nápoje a případné výlety na pevnině.'); break;
    case 'poznavaci': check.push('U poznávacích cest projděte program den po dni, tempo přejezdů a to, zda jsou vstupy a průvodce v ceně.'); break;
    case 'vzdelavaci': check.push('U vzdělávacích cest si ověřte hlavní téma, odborné vedení, jazyk výkladu, vstupy v ceně a náročnost programu.'); break;
    case 'wellness': check.push('U wellness pobytů si potvrďte rozsah vstupů, procedur, víkendové příplatky a pravidla rezervace termínu.'); break;
    case 'eurovikendy': check.push('U eurovíkendů je zásadní poloha ubytování, časy dopravy a reálný čas, který strávíte přímo ve městě.'); break;
    case 'lyzovani': check.push('U lyžování ověřte skipas, vzdálenost od sjezdovky, parkování, kauce a pojištění odpovědnosti.'); break;
    case 'zajezdy': check.push('U zájezdů k moři porovnejte pláž, transfer, typ stravy, recenze hotelu a odletové letiště.'); break;
  }
  const checkPoints = uniq(check).slice(0, 4);

  const related: Array<{ label: string; url: string }> = [];
  const add = (label: string, url: string) => {
    label = label.trim(); url = url.trim();
    if (!label || !url) return;
    if (related.some((e) => e.url === url || e.label === label)) return;
    related.push({ label, url });
  };
  add('Další ' + cat.label.toLowerCase(), `/${cat.path}/`);
  if (countrySlug !== '' && p.country) add('Dovolená ' + p.country, `/${countrySlug}/`);
  if (type === 'zajezdy') { add('Last minute zájezdy', '/last-minute/'); add('All inclusive dovolená', '/all-inclusive/'); }
  else if (type === 'eurovikendy') { add('Kam na eurovíkend', '/kam-na-eurovikend/'); add('Eurovíkend letecky', '/eurovikend-letecky/'); }
  else if (type === 'zazitky') { add('Wellness a lázně', '/wellness-pobyty/'); add('Wellness pobyt pro dva', '/wellness-pobyt-pro-dva/'); add('Eurovíkendy', '/eurovikendy/'); }
  else if (type === 'wellness') { add('Termální lázně', '/termalni-lazne/'); add('Zážitky a pobyty', '/zazitky/'); add('Wellness pobyt pro dva', '/wellness-pobyt-pro-dva/'); }
  else if (type === 'plavby') { add('Zážitky a pobyty', '/zazitky/'); add('Poznávací zájezdy', '/poznavaci-zajezdy/'); }
  else if (type === 'poznavaci') { add('Eurovíkendy', '/eurovikendy/'); add('Adventní zájezdy', '/adventni-zajezdy/'); }
  else if (type === 'vzdelavaci') { add('Poznávací zájezdy', '/poznavaci-zajezdy/'); add('Eurovíkendy', '/eurovikendy/'); }
  add('Všechny inspirace', '/objevte/');

  const faqs: Array<{ q: string; a: string }> = [
    { q: `Jak rezervovat nabídku ${title}?`, a: 'Kakapo.cz nabídku porovnává a rezervaci dokončíte po kliknutí přímo u partnera. Cenu nenavyšujeme a u partnera vždy uvidíte aktuální dostupnost.' },
    { q: 'Co zkontrolovat před rezervací?', a: stripTags(checkPoints[0]! + ' ' + (checkPoints[1] ?? 'Zkontrolujte také termín, rozsah služeb a storno podmínky.')) },
  ];
  if (plabel !== '') faqs.push({ q: 'Kdo nabídku zajišťuje?', a: `Nabídku zajišťuje ${plabel}. Kakapo.cz slouží jako srovnávač a na detail partnera vás přesměruje bez skrytých příplatků.` });

  const descClean = String(p.description ?? '').replace(/^\s*Popis:\s*/iu, '');
  const descParagraphs = descClean.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  return {
    p, title, place, partner, plabel, cat, type, images, terms, hasTerms, rows, goUrl: `/akce/${p.id}/?ctx=product-detail`,
    fitPoints, checkPoints, related: related.slice(0, 8), faqs, descParagraphs, countrySlug,
  };
}
/** Link for one term row (mirrors add_query_arg('t', i, go_product_url(id, 'product-term'))). */
export const termGoUrl = (d: DetailModel, i: number): string => (d.hasTerms ? `/akce/${d.p.id}/?ctx=product-term&t=${d.rows[i]?.idx ?? i}` : d.goUrl);

/** "8. 10. – 15. 10. 2026" like the PHP term cell. */
export function termLabel(t: Term): string {
  const f = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(t.from ?? ''));
  const e = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(t.to ?? ''));
  const dm = (m: RegExpExecArray) => `${Number(m[3])}. ${Number(m[2])}.`;
  const dmy = (m: RegExpExecArray) => `${dm(m)} ${m[1]}`;
  if (f && e && t.to !== t.from) return `${f[1] === e[1] ? dm(f) : dmy(f)} – ${dmy(e)}`;
  if (f) return dmy(f);
  return 'Dle dostupnosti';
}
export { formatPrice };

export const HUB_FAQS = [
  { q: 'Jaký typ zájezdu nebo pobytu vybrat?', a: 'Pokud chcete hlavně odpočinek, začněte wellness pobyty nebo zájezdy k moři. Pro aktivnější cestu se hodí poznávací, vzdělávací a tematické zájezdy, eurovíkendy, plavby nebo lyžování. Zážitky a pobyty jsou dobré hlavně jako dárek nebo krátký únik mimo běžný režim.' },
  { q: 'Je lepší vybírat podle ceny, nebo podle typu pobytu?', a: 'Nejdřív vyberte typ pobytu a až potom cenu. Nejlevnější nabídka může být špatná volba, pokud neodpovídá termínu, lokalitě nebo službám, které od cesty čekáte.' },
  { q: 'Co si ověřit před rezervací?', a: 'Zkontrolujte přesný rozsah služeb, termín, storno podmínky, dopravu, doplatky a to, zda rezervaci dokončujete přímo u pořadatele nebo partnera.' },
];

export const LEGAL_LABELS: Record<string, string> = {
  'ochrana-osobnich-udaju': 'Ochrana osobních údajů', 'podminky-pouziti': 'Podmínky použití', kontakt: 'Kontakt',
};
export const LEGAL_DESCRIPTIONS: Record<string, string> = {
  'ochrana-osobnich-udaju': 'Jak Kakapo.cz nakládá s osobními údaji a cookies. Zásady ochrany soukromí srovnávače dovolených.',
  'podminky-pouziti': 'Podmínky použití srovnávače dovolených Kakapo.cz — jak služba funguje a jaká pravidla platí.',
  kontakt: 'Kontaktujte Kakapo.cz — srovnávač zájezdů, pobytů a zážitků od českých cestovních kanceláří.',
};
/** Verbatim copy of templates/legal.php (marked for legal review in docs/PRODUCTS.md). */
export const LEGAL_HTML: Record<string, string> = {
  'ochrana-osobnich-udaju': `<p class="mt-4">Na Kakapo.cz si vážíme vašeho soukromí. Tato stránka vysvětluje, jaké údaje při provozu srovnávače dovolených zpracováváme a proč.</p>

<h2>Kdo jsme</h2>
<p>Kakapo.cz je srovnávač zájezdů, pobytů a zážitků. Nabídky agregujeme od českých cestovních kanceláří a partnerů. Sami neprodáváme žádné zájezdy — rezervaci vždy dokončujete přímo u pořádající cestovní kanceláře, která je správcem vašich rezervačních údajů.</p>

<h2>Jaké údaje zpracováváme</h2>
<p>Při běžném prohlížení webu nezadáváte žádné osobní údaje. Automaticky zpracováváme pouze technické údaje nezbytné pro provoz a zabezpečení webu (IP adresa, typ prohlížeče, navštívené stránky) a anonymní statistiky návštěvnosti.</p>

<h2>Cookies a analytika</h2>
<p>Web používá cookies pro správné fungování, měření návštěvnosti a vyhodnocení affiliate prokliků. Analytické a marketingové cookies používáme na základě vašeho souhlasu, který můžete kdykoli změnit v nastavení prohlížeče. Nezbytné cookies zajišťují základní funkce webu.</p>

<h2>Affiliate odkazy</h2>
<p>Odkazy na nabídky partnerů jsou affiliate odkazy. Kliknutím na ně můžeme zaznamenat anonymní identifikátor prokliku, díky kterému získáváme provizi. Cenu zájezdu to nijak neovlivňuje a neposkytujeme partnerům vaše osobní údaje.</p>

<h2>Vaše práva</h2>
<p>V souladu s nařízením GDPR máte právo na přístup k údajům, jejich opravu či výmaz a právo vznést námitku proti zpracování. S jakýmkoli dotazem k ochraně soukromí se na nás obraťte e-mailem na <a href="mailto:info@kakapo.cz">info@kakapo.cz</a>.</p>`,
  'podminky-pouziti': `<p class="mt-4">Tyto podmínky upravují používání srovnávače dovolených Kakapo.cz. Používáním webu s nimi vyjadřujete souhlas.</p>

<h2>Jak služba funguje</h2>
<p>Kakapo.cz shromažďuje a porovnává nabídky zájezdů, pobytů a zážitků od českých cestovních kanceláří a partnerů. Zobrazujeme ceny, termíny a další parametry tak, jak je poskytují partneři. Sami nejsme cestovní kanceláří ani prodejcem zájezdů.</p>

<h2>Rezervace a ceny</h2>
<p>Rezervaci a platbu vždy dokončujete přímo u pořádající cestovní kanceláře, jejíž obchodní podmínky se na daný zájezd vztahují. Ceny a dostupnost se mohou průběžně měnit; rozhodující jsou vždy údaje uvedené na webu příslušné cestovní kanceláře v okamžiku rezervace.</p>

<h2>Odpovědnost</h2>
<p>Snažíme se, aby byly zobrazené informace přesné a aktuální, nemůžeme však zaručit jejich úplnou správnost, protože pocházejí od třetích stran. Neneseme odpovědnost za obsah, dostupnost ani plnění nabídek partnerů.</p>

<h2>Affiliate spolupráce</h2>
<p>Provoz webu financujeme z provizí za zprostředkované prokliky a rezervace u partnerů. Tato spolupráce nemá vliv na cenu, kterou u cestovní kanceláře zaplatíte.</p>`,
  kontakt: `<p class="mt-4">Máte dotaz, našli jste chybu v nabídce nebo chcete navázat spolupráci? Ozvěte se nám.</p>

<h2>Napište nám</h2>
<p>E-mail: <a href="mailto:info@kakapo.cz">info@kakapo.cz</a></p>
<p>Rádi zodpovíme dotazy k fungování srovnávače. Upozorňujeme, že Kakapo.cz zájezdy sám neprodává — konkrétní rezervace, platby a reklamace řeší přímo pořádající cestovní kancelář uvedená u dané nabídky.</p>

<h2>Pro cestovní kanceláře</h2>
<p>Jste cestovní kancelář a chcete své nabídky zobrazovat na Kakapo.cz? Napište nám na <a href="mailto:info@kakapo.cz">info@kakapo.cz</a> a domluvíme si podmínky spolupráce.</p>

<h2>Kdo za webem stojí</h2>
<p>Kakapo vytvořil Ha Duy Huy (Kenny), SEO konzultant, který si sám staví i vyhledávače zájezdů. Nabídky přebírá přímo od cestovních kanceláří, takže cenu platíte u nich, bez přirážky. Víc o autorovi najdete na <a href="https://huy.cz/" rel="nofollow">huy.cz</a>.</p>`,
};
