// Loaders for listing / topic / home pages (data + meta + JSON-LD). Astro components in src/components/{listing,home} render them.
import { jsonArr, MEAL_LABELS, partnerLabel, partnerLogoUrl } from '../helpers';
import { loadRegistry, type Registry } from '../snapshots';
import { countMany, normalizeFilters, search, todayPrague, type Filters, type HotelRow, type SearchResult } from '../search';
import topicData from '../../data/topic-landings.json';
import partnerConsts from '../../data/partner-consts.json';
import { facets, type Facets } from './facets';
import { calendarMonths, topDrops } from './calendar';
import { memoized, storedJson, versionedJson } from './cache';
import type { Faq, LandingCtx, ListingDeps } from './landing-types';
import { DEST_PHOTO_SLUGS, SITE, homeFaqs, homeLd, isIndexable, landingDescription, landingTitle, listingLd, normalizeFaqs, topicLd, topicTitle } from './seo';

export type { LandingCtx, ListingDeps } from './landing-types';
export { facets } from './facets';
export { normalizeFaqs, homeFaqs } from './seo';

export const GET_KEYS = ['country', 'dest', 'q', 'meal', 'stars', 'airport', 'partner', 'price_min', 'price_max', 'rating_min', 'date_from', 'date_to', 'nights_min', 'nights_max', 'adults', 'flag', 'theme', 'transport', 'sort'];
export const SORT_OPTIONS: Record<string, string> = { recommended: 'Doporučené', price: 'Nejlevnější', 'price-desc': 'Nejdražší', departure: 'Nejbližší odlet', discount: 'Největší sleva', drop: 'Největší zlevnění', rating: 'Nejlépe hodnocené' };

const TOPICS = topicData as unknown as Record<string, any>;
/** Static (undated) topic definition; pages normally pass the hydrated topic via ctx.topic. */
export const getTopic = (slug: string): any | null => TOPICS[slug] ?? null;

/** Search with a short isolate memo — the same filter set is asked for by the page, the meta and the JSON-LD. */
const msearch = (db: D1Database, f: Filters, today: string): Promise<SearchResult> => memoized('s:' + JSON.stringify(f) + today, 120, () => search(db, f, today));

export interface ListingData {
  ctx: LandingCtx;
  filters: Filters;               // active filters (landing + GET)
  active: Filters;
  result: SearchResult;
  facets: Facets;
  sort: string;
  totalLabel: string;
  cfg: { pathFilters: Record<string, unknown>; sort: string; total: number; q: string; adults: number };
  hasQuery: boolean;
  quickMinPrice: number;
  quickDestinations: Array<{ slug: string; label: string }>;
  quickMeals: Array<{ slug: string; label: string }>;
  popularGroups: Array<{ label: string; links: Array<{ path: string; h1: string }> }>;
  longtailLinks: Array<{ path: string; h1: string }>;
  moneyLinks: Array<[string, string]>;
  destChips: Array<{ slug: string; label: string; cnt: number }>;
  calendar: Array<{ ym: string; mp: number }>;
  registry: Registry;
  countrySlug: string; destSlug: string;
  faqs: Faq[];
  meta: { title: string; description: string; canonical: string; robots: string[]; image: string; jsonLd: unknown[] };
}

export function totalLabel(n: number): string {
  if (n === 1) return 'nalezen 1 hotel';
  if (n >= 2 && n <= 4) return `nalezeny ${n} hotely`;
  return `nalezeno ${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} hotelů`;
}

const MONEY_LINK_SETS: Record<string, Array<[string, string]>> = {
  '/zajezdy/': [['Last minute all inclusive', '/last-minute-all-inclusive/'], ['Dovolená u moře all inclusive', '/dovolena-u-more-all-inclusive/'], ['Řecko all inclusive', '/recko-all-inclusive/'], ['Turecko all inclusive', '/turecko-all-inclusive/'], ['Egypt last minute all inclusive', '/egypt-last-minute-all-inclusive/'], ['Kam v srpnu k moři', '/kam-v-srpnu-k-mori/']],
  '/dovolena-u-more/': [['Dovolená u moře all inclusive', '/dovolena-u-more-all-inclusive/'], ['Levná dovolená u moře all inclusive', '/levna-dovolena-u-more-all-inclusive/'], ['Kam v červenci k moři', '/kam-v-cervenci-k-mori/'], ['Kam v srpnu k moři', '/kam-v-srpnu-k-mori/'], ['Kam v září k moři', '/kam-v-zari-k-mori/'], ['Dovolená s dětmi u moře all inclusive', '/dovolena-s-detmi-u-more-all-inclusive/']],
  '/last-minute/': [['Last minute all inclusive', '/last-minute-all-inclusive/'], ['Last minute all inclusive z Prahy', '/last-minute-all-inclusive-z-prahy/'], ['Last minute all inclusive z Brna', '/last-minute-all-inclusive-z-brna/'], ['Egypt last minute all inclusive', '/egypt-last-minute-all-inclusive/'], ['Řecko last minute all inclusive', '/recko-last-minute-all-inclusive/'], ['Super last minute odlet zítra', '/super-last-minute-odlet-zitra/']],
  '/all-inclusive/': [['Dovolená u moře all inclusive', '/dovolena-u-more-all-inclusive/'], ['Levná dovolená u moře all inclusive', '/levna-dovolena-u-more-all-inclusive/'], ['Dovolená s dětmi u moře all inclusive', '/dovolena-s-detmi-u-more-all-inclusive/'], ['Řecko all inclusive', '/recko-all-inclusive/'], ['Bulharsko all inclusive', '/bulharsko-all-inclusive/'], ['Tunisko all inclusive', '/tunisko-all-inclusive/']],
};
const POPULAR_SETS: Array<[string, string[]]> = [
  ['Typ dovolené', ['all-inclusive', 'last-minute', 'dovolena-s-detmi', 'dovolena-u-more', 'levna-dovolena', 'luxusni-dovolena']],
  ['Odlet', ['odlet-z-prahy', 'odlet-z-brna', 'odlet-z-ostravy', 'last-minute-z-prahy', 'last-minute-z-brna', 'last-minute-z-ostravy', 'last-minute-all-inclusive-z-prahy', 'dovolena-z-prahy-all-inclusive']],
  ['Sezóna', ['kam-v-srpnu-k-mori', 'kam-v-zari-k-mori', 'kam-v-rijnu-k-mori', 'kam-v-prosinci-k-mori', 'dovolena-srpen', 'dovolena-zari', 'dovolena-rijen', 'dovolena-prosinec']],
  ['All inclusive', ['dovolena-u-more-all-inclusive', 'levna-dovolena-u-more-all-inclusive', 'dovolena-s-detmi-u-more-all-inclusive', 'nejlevnejsi-dovolena-u-more-letecky-all-inclusive']],
];

/** Landing filters + GET params (GET wins), exactly like search.php. */
export function mergeFilters(ctxFilters: Record<string, unknown>, query: URLSearchParams): Filters {
  const merged: Record<string, unknown> = { ...ctxFilters };
  for (const k of GET_KEYS) { const v = query.get(k); if (v !== null && v !== '') merged[k] = v; }
  merged.page = Math.max(1, parseInt(query.get('strana') ?? '1', 10) || 1);
  return normalizeFilters(merged);
}

/** Related longtail chips cost up to 48 counts → computed once per landing and cached (path-level, not per visitor). */
async function longtailBlocks(db: D1Database, ctx: LandingCtx, country: string, dest: string, deps: ListingDeps, today: string) {
  const lt = deps.longtail;
  if (!lt || !country) return { all: [] as Array<{ path: string; h1: string }>, groups: [] as ListingData['popularGroups'] };
  return memoized(`lt:${ctx.path}:${today}`, 3600, () => storedJson(db, `lt:${ctx.path}`, 3 * 3600, async () => {
    // all topic contexts first (pure), then every COUNT in one batch round trip
    if ((globalThis as any).__D1_TRACE) console.log('LT start ' + ctx.path);
    const slugs = [...new Set([...lt.topicSlugs(), ...POPULAR_SETS.flatMap(([, s]) => s)])];
    const ctxs = await Promise.all(slugs.map((slug) => lt.context(db, country, dest, slug)));
    const todo = ctxs.map((c, i) => (c && c.path !== ctx.path ? { slug: slugs[i]!, c } : null)).filter((x): x is { slug: string; c: NonNullable<typeof ctxs[number]> } => !!x);
    if ((globalThis as any).__D1_TRACE) console.log('LT contexts ' + todo.length);
    const counts = await countMany(db, todo.map((t) => normalizeFilters({ ...t.c.filters, page: 1 })));
    const ok = new Map<string, { path: string; h1: string }>();
    todo.forEach((t, i) => { if ((counts[i] ?? 0) >= Number(t.c.index_min ?? 12)) ok.set(t.slug, { path: t.c.path, h1: t.c.h1 }); });
    const all = lt.topicSlugs().map((s) => ok.get(s)).filter((x): x is { path: string; h1: string } => !!x);
    const groups: ListingData['popularGroups'] = [];
    for (const [label, ss] of POPULAR_SETS) {
      const links: Array<{ path: string; h1: string }> = [];
      for (const s of ss) { const r = ok.get(s); if (r) links.push(r); if (links.length >= 6) break; }
      if (links.length) groups.push({ label, links });
    }
    return { all, groups };
  }));
}

export async function loadListing(db: D1Database, ctx: LandingCtx, query: URLSearchParams, deps: ListingDeps = {}): Promise<ListingData> {
  const today = deps.today ?? todayPrague();
  const registry = await loadRegistry(db);
  const filters = mergeFilters(ctx.filters ?? {}, query);
  // The clean landing (no GET filters, page 1) is the same for every visitor until the next import: cache it in D1
  // (one row read instead of tens of thousands), keyed by data_version, so a cache-cold colo or a crawler is cheap.
  const plain = !query.toString() || ![...query.keys()].some((k) => !/^(utm_[a-z]+|fbclid|gclid|gbraid|wbraid|msclkid|yclid|mc_[a-z]+|ref|_ga)$/i.test(k));
  const slim = (r: SearchResult): SearchResult => ({ ...r, hotels: r.hotels.map(({ description: _d, images_json: _i, amenities_json: _a, ...h }) => ({ ...h, images: (h.images ?? []).slice(0, 3) }) as HotelRow) }); // cards need no texts
  const heavy = async () => ({ result: slim(await search(db, filters, today)), fct: await facets(db, filters) });
  const { result, fct } = plain && deps.dataVersion && filters.page === 1
    ? await versionedJson(db, `lp:${ctx.path}`, `${today}|${deps.dataVersion}`, heavy)
    : await heavy();
  const active = normalizeFilters(filters as unknown as Record<string, unknown>);
  const sort = SORT_OPTIONS[active.sort] ? active.sort : 'recommended';
  const ctxFilters = normalizeFilters({ ...(ctx.filters ?? {}), page: 1 });
  // tracking parameters (utm_*, fbclid, gclid, msclkid, ref) do not change the content → not a filtered variant
  const hasQuery = [...query.keys()].some((k) => !/^(utm_[a-z]+|fbclid|gclid|gbraid|wbraid|msclkid|yclid|mc_[a-z]+|ref|_ga)$/i.test(k));

  // quick min price: first hotel of the price-sorted search
  let quickMinPrice = 0;
  const probe = sort === 'price' && result.page === 1 ? result : await msearch(db, { ...filters, sort: 'price', page: 1 }, today);
  if (probe.hotels[0]?.min_price) quickMinPrice = Number(probe.hotels[0].min_price);

  const countrySlug = String((ctx.filters as any)?.country ?? ''); const destSlug = String((ctx.filters as any)?.dest ?? '');
  const quickDestinations: Array<{ slug: string; label: string }> = [];
  if (countrySlug) {
    const clabel = (registry.countries[countrySlug]?.label ?? '').toLowerCase();
    for (const [slug, d] of Object.entries(registry.destinations[countrySlug] ?? {})) {
      if ((destSlug && slug === destSlug) || slug === countrySlug || d.label.toLowerCase() === clabel) continue;
      quickDestinations.push({ slug, label: d.label });
      if (quickDestinations.length >= 4) break;
    }
  }
  const quickMeals = (fct.meals ?? []).slice(0, 3);
  const lt = await longtailBlocks(db, ctx, countrySlug, destSlug, deps, today);
  const moneyLinks = (MONEY_LINK_SETS[ctx.path] ?? []).filter(([, p]) => p !== ctx.path);
  const destChips = countrySlug && !destSlug
    ? Object.entries(registry.destinations[countrySlug] ?? {}).map(([slug, d]) => ({ slug, label: d.label, cnt: d.cnt })).sort((a, b) => b.cnt - a.cnt).slice(0, 12) : [];
  const calendar = countrySlug && !hasQuery ? await calendarMonths(db, countrySlug, destSlug, today) : [];

  // --- meta (computed from landing filters only, like Kakapo_Seo::meta) ---
  const baseResult = await msearch(db, ctxFilters, today);
  const baseProbe = await msearch(db, { ...ctxFilters, sort: 'price', page: 1 }, today);
  const topic = (ctx.topic as any) ?? (deps.topicSlug ? getTopic(deps.topicSlug) : null);
  const isCkPage = !!topic?.partner_page;
  const alias = deps.canonicalAlias ? deps.canonicalAlias(ctx.path) : '';
  const indexMin = Math.max(1, Number(ctx.index_min ?? (topic ? topic.index_min ?? 1 : 1)));
  const robots = isIndexable({ index_min: indexMin }, baseResult.total, { hasQuery, aliasTarget: alias }) ? ['index', 'follow'] : ['noindex', 'follow'];
  let canonical = alias !== '' ? SITE + alias : SITE + ctx.path;
  const pageNo = Math.max(1, parseInt(query.get('strana') ?? '1', 10) || 1);
  if (pageNo > 1 && alias === '') canonical += `?strana=${pageNo}`;
  const title = topic ? topicTitle({ title: ctx.title || topic.title, h1: ctx.h1, label: topic.label }) : landingTitle(ctx);
  const description = isCkPage ? String(ctx.description ?? '') : landingDescription({ h1: ctx.h1, description: ctx.description, filters: ctx.filters as { sort?: string } }, baseResult.total, { minPrice: Number(baseProbe.hotels[0]?.min_price ?? 0), firstDeparture: String(baseResult.hotels[0]?.best_offer?.departure_date ?? ''), today });
  const faqs = normalizeFaqs(ctx.faqs);
  const image = topic ? String(topic.hero_image ?? '') : DEST_PHOTO_SLUGS.includes(countrySlug) ? `/wp-content/kakapo-assets/img/dest/${countrySlug}.webp` : '';
  const crumbsAbs = ctx.breadcrumbs.map((c) => ({ label: c.label, url: c.url || undefined }));
  const indexable = robots[0] === 'index';
  const jsonLd = [listingLd({ crumbs: crumbsAbs, canonical, indexable, faqs, hotels: baseResult.hotels })];
  if (topic && topic.cards?.length && indexable) {
    // topic listings additionally expose their curated cards as ItemList (like the PHP topic branch)
    const g = jsonLd[0] as any; g['@graph'].push(...(topicLd({ crumbs: [], canonical, indexable: true, faqs: [], cards: topic.cards }) as any)['@graph'].filter((x: any) => x['@type'] === 'ItemList'));
  }

  return {
    ctx, filters, active, result, facets: fct, sort, totalLabel: totalLabel(result.total),
    cfg: { pathFilters: (ctx.filters ?? {}) as Record<string, unknown>, sort, total: result.total, q: String(active.q ?? ''), adults: Number(active.adults ?? 0) },
    hasQuery, quickMinPrice, quickDestinations, quickMeals, popularGroups: lt.groups, longtailLinks: lt.all, moneyLinks, destChips, calendar, registry,
    countrySlug, destSlug, faqs,
    meta: { title, description, canonical, robots, image, jsonLd },
  };
}

// ----------------------------------------------------------------------------- topic (non-listing)
export interface TopicData { topic: any; meta: { title: string; description: string; canonical: string; robots: string[]; image: string; jsonLd: unknown[] } }
export function loadTopic(topicOrSlug: any, query: URLSearchParams): TopicData | null {
  const topic = typeof topicOrSlug === 'string' ? getTopic(topicOrSlug) : topicOrSlug;
  if (!topic) return null;
  const canonical = SITE + topic.path;
  const robots = [...query.keys()].length === 0 ? ['index', 'follow'] : ['noindex', 'follow'];
  const indexable = robots[0] === 'index';
  const faqs = (Array.isArray(topic.faqs) ? topic.faqs : []) as Faq[];
  return {
    topic,
    meta: {
      title: topicTitle(topic), description: String(topic.description ?? ''), canonical, robots, image: String(topic.hero_image ?? ''),
      jsonLd: [topicLd({ crumbs: [{ label: 'Domů', url: '/' }, { label: topic.label }], canonical, indexable, faqs, cards: topic.cards ?? [] })],
    },
  };
}

// ----------------------------------------------------------------------------- home
export interface HomeData {
  countries: Array<{ slug: string; label: string; cnt: number; min_price: number }>;
  partners: Array<{ slug: string; label: string; logo: string; cnt: number; hub: boolean }>;
  offersRound: number; ckCount: number; ckLabel: string; minPrice: number;
  sections: Array<{ key: string; title: string; url: string; sub: string; hotels: HotelRow[] }>;
  deals: HotelRow[]; picked: HotelRow[]; drops: HotelRow[];
  products: any[];
  faqs: Faq[];
  meta: { title: string; description: string; canonical: string; robots: string[]; image: string; jsonLd: unknown[] };
}
const SEA_PRIORITY = ['egypt', 'recko', 'turecko', 'tunisko', 'bulharsko', 'spanelsko', 'italie', 'chorvatsko'];
const SEA_EXCLUDE = ['cesko', 'ceska-republika', 'slovensko', 'polsko', 'rakousko', 'nemecko', 'madarsko'];

export async function loadHome(db: D1Database, today = todayPrague()): Promise<HomeData> {
  const registry = await loadRegistry(db);
  const countries: HomeData['countries'] = [];
  for (const slug of SEA_PRIORITY) if (registry.countries[slug]) countries.push({ slug, ...registry.countries[slug]! });
  if (countries.length < 8) for (const [slug, c] of Object.entries(registry.countries)) {
    if (countries.some((x) => x.slug === slug) || SEA_EXCLUDE.includes(slug)) continue;
    countries.push({ slug, ...c }); if (countries.length >= 8) break;
  }
  const partnersAll = Object.values(registry.partners);
  const offersTotal = partnersAll.reduce((a, p) => a + p.cnt, 0);
  const offersRound = Math.floor(offersTotal / 100) * 100;
  const ck = partnersAll.length;
  const ckLabel = ck === 1 ? '1 cestovní kancelář' : ck >= 2 && ck <= 4 ? `${ck} cestovní kanceláře` : `${ck} cestovních kanceláří`;
  let minPrice = 0;
  for (const c of Object.values(registry.countries)) if (c.min_price > 0 && (minPrice === 0 || c.min_price < minPrice)) minPrice = c.min_price;

  const base = { country_exclude: SEA_EXCLUDE };
  const clean = (rows: HotelRow[], n: number, pred: (h: HotelRow) => boolean = () => true) => rows.filter((h) => !SEA_EXCLUDE.includes(String(h.country_slug ?? '')) && pred(h)).slice(0, n);
  const defs: Array<[string, string, Record<string, unknown>, string, string]> = [
    ['last-minute', 'Last minute', { flag: 'last-minute' }, '/last-minute/', 'Odlety v nejbližších dnech.'],
    ['first-minute', 'First minute', { flag: 'first-minute' }, '/first-minute/', 'Zamluvte s předstihem a vyberte si nejlepší termín.'],
    ['cheapest', 'Nejlevnější zájezdy', { sort: 'price' }, '/levna-dovolena/', 'Dovolená u moře za pár korun.'],
  ];
  const sections: HomeData['sections'] = [];
  for (const [key, title, f, url, sub] of defs) {
    const res = await msearch(db, normalizeFilters({ ...f, ...base }), today);
    const hotels = clean(res.hotels, 4);
    if (hotels.length) sections.push({ key, title, url, sub, hotels });
  }
  const dealsRes = await msearch(db, normalizeFilters({ sort: 'price', ...base }), today);
  const deals = clean(dealsRes.hotels, 10, (h) => !!h.best_offer?.departure_date);
  const pickedRes = await msearch(db, normalizeFilters({ sort: 'rating', ...base }), today);
  const picked = clean(pickedRes.hotels, 4, (h) => jsonArr(h.images).length > 0 && !!jsonArr(h.images)[0]);
  const dropsAll = await topDrops(db, 8);

  const products = (await db.prepare('SELECT * FROM products WHERE active = 1 AND hidden = 0 ORDER BY price ASC LIMIT 8').all<any>()).results;
  const hubs = (partnerConsts as { PARTNERS: Record<string, unknown> }).PARTNERS;
  let badges = partnersAll.map((p) => ({ slug: p.slug, label: p.label || partnerLabel(p.slug), logo: partnerLogoUrl(p.slug), cnt: p.cnt, hub: !!hubs[p.slug] })).filter((b) => b.label);
  badges.sort((a, b) => (!!a.logo !== !!b.logo ? (a.logo ? -1 : 1) : b.cnt - a.cnt));
  badges = badges.slice(0, 8);
  if (!badges.length) badges = Object.entries({ fischer: 'Fischer', 'exim-tours': 'Exim Tours', 'blue-style': 'Blue Style', tui: 'TUI', invia: 'Invia', 'dovolena-cz': 'Dovolena.cz', slevomat: 'Slevomat' }).map(([slug, label]) => ({ slug, label, logo: partnerLogoUrl(slug), cnt: 0, hub: !!hubs[slug] }));

  const faqs = homeFaqs();
  return {
    countries, partners: badges, offersRound, ckCount: ck, ckLabel, minPrice, sections, deals, picked, drops: dropsAll, products, faqs,
    meta: {
      title: 'Dovolená 2026: zájezdy u moře, last minute i all inclusive | Kakapo.cz',
      description: 'Porovnejte dovolenou 2026 od českých cestovek. Zájezdy u moře, last minute, all inclusive i dovolená s dětmi na jednom místě — bez příplatků.',
      canonical: SITE + '/', robots: ['index', 'follow'], image: '/wp-content/kakapo-assets/img/dest/hero-1600.webp', jsonLd: [homeLd(faqs)],
    },
  };
}

/** Public JSON shape of /api/search (what assets/js/frontend.js renderCard() expects). */
export function apiHotel(h: HotelRow, helpers: { imgUrl: (u: string, w: number) => string; imgSrcset: (u: string, w: number) => string; flagUrl: (c: string, s: string) => string }) {
  const best = h.best_offer;
  return {
    id: Number(h.id), slug: h.slug, url: `/hotel/${h.slug}/`, name: h.name, country: h.country, country_slug: h.country_slug,
    country_flag: '', country_flag_url: helpers.flagUrl(String(h.country ?? ''), String(h.country_slug ?? '')),
    destination: h.destination, city: h.city, stars: Number(h.stars), rating: h.rating !== null && h.rating !== undefined ? Number(h.rating) : null,
    image: helpers.imgUrl(h.images[0] ?? '', 640), image_srcset: helpers.imgSrcset(h.images[0] ?? '', 640),
    min_price: h.min_price !== null && h.min_price !== undefined ? Number(h.min_price) : null,
    price_drop: h.price_drop_pct ? Number(h.price_drop_pct) : null, partners: Number(h.partners_count), offers: Number(h.offers_active),
    best_offer: best ? {
      id: Number(best.id), price_pp: Number(best.price_pp), price_original: best.price_original ? Number(best.price_original) : null,
      discount: best.price_original > 0 ? Math.round(100 * (1 - best.price_pp / best.price_original)) : null,
      departure_date: best.departure_date, nights: Number(best.nights), meal_type: best.meal_type, meal_label: MEAL_LABELS[best.meal_type] ?? best.meal_type,
      airport: best.airport, partner: best.partner_slug, is_last_minute: !!best.is_last_minute, go_url: `/go/${Number(best.id)}/?ctx=listing`,
    } : null,
  };
}
