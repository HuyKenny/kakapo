import { seasonYear } from '../../src/lib/year';
import { beforeAll, describe, expect, it } from 'vitest';
import { memoryDb } from '../landing/d1';
import { apiHotel, loadHome, loadListing, loadTopic, mergeFilters, totalLabel, type LandingCtx } from '../../src/lib/listing';
import { facets } from '../../src/lib/listing/facets';
import { normalizeFilters, search } from '../../src/lib/search';
import { countryFlagUrl, imgUrl } from '../../src/lib/helpers';
import topics from '../../src/data/topic-landings.json';

const TODAY = '2026-10-26';
const now = '2026-10-26T10:00:00Z';
let db: D1Database;
let raw: ReturnType<typeof memoryDb>['raw'];

function ctxFor(filters: Record<string, unknown>, extra: Partial<LandingCtx> = {}): LandingCtx {
  return { type: 'country', filters, h1: 'Dovolená Řecko', title: 'Dovolená Řecko 2026 — zájezdy, hotely a ceny | Kakapo.cz', description: 'x', path: '/recko/', breadcrumbs: [{ label: 'Domů', url: '/' }, { label: 'Řecko' }], intro: '', seo_text: '', faqs: [], ...extra };
}

beforeAll(() => {
  ({ raw, db } = memoryDb());
  raw.exec(`INSERT INTO partners (slug,name) VALUES ('fischer','Fischer'),('invia','Invia')`);
  raw.exec(`INSERT INTO feeds (id,name,partner_slug,adapter,content_type,source_ref) VALUES (1,'F','fischer','cj-atcom','hotels','FEED_URL_1')`);
  const h = raw.prepare(`INSERT INTO hotels (id,slug,dedup_key,name,country,country_slug,destination,destination_slug,stars,rating,images_json,min_price,offers_active,partners_count,has_last_minute,meal_flags,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,1,?,?,?,?)`);
  const o = raw.prepare(`INSERT INTO offers (id,hotel_id,feed_id,partner_slug,external_id,content_hash,price_pp,departure_date,nights,meal_type,airport,airport_slug,is_last_minute,affiliate_url,active,last_seen,created_at,updated_at) VALUES (?,?,1,'fischer',?,'h',?,?,7,?,?,?,?,'https://x.test/a',1,?,?,?)`);
  for (let i = 1; i <= 30; i++) {
    const country = i <= 26 ? ['Řecko', 'recko'] : ['Turecko', 'turecko'];
    const price = 10000 + i * 100;
    h.run(i, `hotel-${i}`, `k${i}`, `Hotel ${i}`, country[0]!, country[1]!, i <= 13 ? 'Kréta' : 'Rhodos', i <= 13 ? 'kreta' : 'rhodos', 3 + (i % 3), i % 2 ? 8.4 : null, '["https://img.test/a.jpg"]', price, i % 4 === 0 ? 1 : 0, i % 2 ? 1 : 4, now, now);
    o.run(i, i, `e${i}`, price, i % 4 === 0 ? '2026-10-30' : '2026-12-01', i % 2 ? 'all-inclusive' : 'snidane', 'Praha', 'praha', i % 4 === 0 ? 1 : 0, now, now, now);
  }
});

describe('mergeFilters / normalizeFilters', () => {
  it('GET params win over landing filters and strana sets the page', () => {
    const f = mergeFilters({ country: 'recko', meal: ['all-inclusive'] }, new URLSearchParams('meal=snidane&strana=3&bogus=1'));
    expect(f.country).toBe('recko'); expect(f.meal).toEqual(['snidane']); expect(f.page).toBe(3);
  });
  it('rejects unknown sort and clamps adults', () => {
    const f = normalizeFilters({ sort: 'hack', adults: '99' });
    expect(f.sort).toBe('recommended'); expect(f.adults).toBe(10);
  });
});

describe('loadListing', () => {
  it('paginates at 24 and exposes page links data', async () => {
    const d = await loadListing(db, ctxFor({ country: 'recko' }), new URLSearchParams(), { today: TODAY });
    expect(d.result.total).toBe(26); expect(d.result.pages).toBe(2); expect(d.result.hotels).toHaveLength(24);
    const p2 = await loadListing(db, ctxFor({ country: 'recko' }), new URLSearchParams('strana=2'), { today: TODAY });
    expect(p2.result.hotels).toHaveLength(2); expect(p2.result.page).toBe(2);
    expect(d.totalLabel).toBe('nalezeno 26 hotelů');
  });
  it('index/noindex rules: clean landing indexable, any query = noindex, paging gets self canonical', async () => {
    const clean = await loadListing(db, ctxFor({ country: 'recko' }, { index_min: 12 }), new URLSearchParams(), { today: TODAY });
    expect(clean.meta.robots).toEqual(['index', 'follow']); expect(clean.meta.canonical).toBe('https://kakapo.cz/recko/');
    const filtered = await loadListing(db, ctxFor({ country: 'recko' }, { index_min: 12 }), new URLSearchParams('meal=snidane'), { today: TODAY });
    expect(filtered.meta.robots).toEqual(['noindex', 'follow']); expect(filtered.meta.canonical).toBe('https://kakapo.cz/recko/');
    const p2 = await loadListing(db, ctxFor({ country: 'recko' }, { index_min: 12 }), new URLSearchParams('strana=2'), { today: TODAY });
    expect(p2.meta.robots[0]).toBe('noindex'); expect(p2.meta.canonical).toBe('https://kakapo.cz/recko/?strana=2');
  });
  it('thin landing (below index_min) and canonical alias are noindex', async () => {
    const thin = await loadListing(db, ctxFor({ country: 'turecko' }, { path: '/turecko/', index_min: 12 }), new URLSearchParams(), { today: TODAY });
    expect(thin.result.total).toBe(4); expect(thin.meta.robots[0]).toBe('noindex');
    const alias = await loadListing(db, ctxFor({ country: 'recko' }, { index_min: 1 }), new URLSearchParams(), { today: TODAY, canonicalAlias: () => '/kypr/' });
    expect(alias.meta.robots[0]).toBe('noindex'); expect(alias.meta.canonical).toBe('https://kakapo.cz/kypr/');
  });
  it('description carries live numbers; title ≤ 60 chars', async () => {
    const d = await loadListing(db, ctxFor({ country: 'recko' }), new URLSearchParams(), { today: TODAY });
    expect(d.meta.description).toContain('Dovolená Řecko: 26 hotelů od 10 100 Kč');
    expect([...d.meta.title].length).toBeLessThanOrEqual(60);
  });
  it('JSON-LD: breadcrumbs always, FAQ + ItemList only when indexable', async () => {
    const faqs = [{ q: 'Q?', a: '<p>A</p>' }];
    const idx = await loadListing(db, ctxFor({ country: 'recko' }, { faqs, index_min: 1 }), new URLSearchParams(), { today: TODAY });
    const types = ((idx.meta.jsonLd[0] as any)['@graph'] as any[]).map((g) => g['@type']);
    expect(types).toEqual(['BreadcrumbList', 'FAQPage', 'ItemList']);
    const items = ((idx.meta.jsonLd[0] as any)['@graph'] as any[]).find((g) => g['@type'] === 'ItemList').itemListElement;
    expect(items).toHaveLength(12); expect(items[0].url).toMatch(/^https:\/\/kakapo\.cz\/hotel\//);
    const noidx = await loadListing(db, ctxFor({ country: 'recko' }, { faqs }), new URLSearchParams('meal=snidane'), { today: TODAY });
    expect(((noidx.meta.jsonLd[0] as any)['@graph'] as any[]).map((g) => g['@type'])).toEqual(['BreadcrumbList']);
  });
  it('filters: stars, price, last minute flag, meal via offers', async () => {
    const ai = await search(db, normalizeFilters({ country: 'recko', meal: 'all-inclusive' }), TODAY);
    expect(ai.total).toBe(13); expect(ai.hotels.every((x) => x.best_offer?.meal_type === 'all-inclusive')).toBe(true);
    const lm = await search(db, normalizeFilters({ flag: 'last-minute' }), TODAY);
    expect(lm.total).toBe(7);
    const cheap = await search(db, normalizeFilters({ price_max: 10300 }), TODAY);
    expect(cheap.total).toBe(3);
    expect((await search(db, normalizeFilters({ stars: '5' }), TODAY)).hotels.every((x) => x.stars === 5)).toBe(true);
  });
  it('empty result still renders data (no crash) and quick values', async () => {
    const d = await loadListing(db, ctxFor({ country: 'recko' }), new URLSearchParams('price_max=1'), { today: TODAY });
    expect(d.result.total).toBe(0); expect(d.result.hotels).toEqual([]); expect(d.quickMinPrice).toBe(0);
  });
  it('quick destinations / chips come from the registry', async () => {
    const d = await loadListing(db, ctxFor({ country: 'recko' }), new URLSearchParams(), { today: TODAY });
    expect(d.destChips.map((c) => c.slug).sort()).toEqual(['kreta', 'rhodos']);
    expect(d.quickDestinations.length).toBeGreaterThan(0);
    expect(d.calendar.length).toBeGreaterThanOrEqual(1);
  });
});

describe('facets', () => {
  it('zero-filter state uses the global snapshot (has nights)', async () => {
    const f = await facets(db, {});
    expect(f.countries!.map((c) => c.slug).sort()).toEqual(['recko', 'turecko']); expect(f.nights).toBeDefined();
  });
  it('filtered facets are hotel-level and meal counts are bit based', async () => {
    const f = await facets(db, { country: 'recko' });
    expect(f.countries!.find((c) => c.slug === 'recko')!.cnt).toBe(26);
    expect(f.destinations!.map((d) => d.slug).sort()).toEqual(['kreta', 'rhodos']);
    expect(f.meals).toEqual([{ slug: 'all-inclusive', label: 'All inclusive', cnt: 13 }, { slug: 'snidane', label: 'Snídaně', cnt: 13 }]);
    raw.exec('UPDATE hotels SET meal_flags = 0; UPDATE hotels SET meal_flags = 1 WHERE id <= 5');
    const g = await facets(db, { country: 'recko', price_max: 99999 });
    expect(g.meals).toEqual([{ slug: 'all-inclusive', label: 'All inclusive', cnt: 5 }]);
  });
});

describe('/api/search shape', () => {
  it('matches what frontend.js renderCard expects', async () => {
    const r = await search(db, normalizeFilters({ country: 'recko', sort: 'price' }), TODAY);
    const h = apiHotel(r.hotels[0]!, { imgUrl, imgSrcset: (u, w) => imgUrl(u, w), flagUrl: countryFlagUrl });
    expect(Object.keys(h).sort()).toEqual(['best_offer', 'city', 'country', 'country_flag', 'country_flag_url', 'country_slug', 'destination', 'id', 'image', 'image_srcset', 'min_price', 'name', 'offers', 'partners', 'price_drop', 'rating', 'slug', 'stars', 'url'].sort());
    expect(h.url).toBe('/hotel/hotel-1/'); expect(h.best_offer!.go_url).toBe('/go/1/?ctx=listing');
    expect(Object.keys(h.best_offer!).sort()).toEqual(['airport', 'departure_date', 'discount', 'go_url', 'id', 'is_last_minute', 'meal_label', 'meal_type', 'nights', 'partner', 'price_original', 'price_pp'].sort());
  });
});

describe('home + topic', () => {
  it('loadHome builds sections without foreign countries and has WebSite+FAQ JSON-LD', async () => {
    raw.exec(`INSERT INTO hotels (id,slug,dedup_key,name,country,country_slug,images_json,min_price,offers_active,created_at,updated_at) VALUES (99,'cz','z','CZ hotel','Česko','cesko','["https://i/x.jpg"]',500,1,'${now}','${now}')`);
    raw.exec(`INSERT INTO offers (id,hotel_id,feed_id,partner_slug,external_id,content_hash,price_pp,departure_date,affiliate_url,active,last_seen,created_at,updated_at) VALUES (99,99,1,'fischer','z','h',500,'2026-11-01','https://x.test/a',1,'${now}','${now}','${now}')`);
    const d = await loadHome(db, TODAY);
    for (const s of d.sections) expect(s.hotels.every((x) => x.country_slug !== 'cesko')).toBe(true);
    expect(d.deals.every((x) => x.country_slug !== 'cesko')).toBe(true);
    expect(d.deals.length).toBeLessThanOrEqual(10);
    const types = ((d.meta.jsonLd[0] as any)['@graph'] as any[]).map((g) => g['@type']);
    expect(types).toEqual(['WebSite', 'FAQPage']);
    expect(d.faqs).toHaveLength(6); expect(d.meta.title).toContain(`Dovolená ${seasonYear()}`);
  });
  it('loadTopic: index only without query, FAQ + cards ItemList', () => {
    const slug = Object.entries(topics as Record<string, any>).find(([, v]) => !v.listing && v.faqs?.length && v.cards?.length)?.[0];
    expect(slug).toBeTruthy();
    const t = loadTopic(slug!, new URLSearchParams())!;
    expect(t.meta.robots).toEqual(['index', 'follow']);
    const g = (t.meta.jsonLd[0] as any)['@graph'].map((x: any) => x['@type']);
    expect(g).toEqual(['BreadcrumbList', 'FAQPage', 'ItemList']);
    expect(loadTopic(slug!, new URLSearchParams('utm=1'))!.meta.robots[0]).toBe('noindex');
    expect([...t.meta.title].length).toBeLessThanOrEqual(60);
  });
  it('totalLabel pluralises', () => { expect(totalLabel(1)).toBe('nalezen 1 hotel'); expect(totalLabel(3)).toBe('nalezeny 3 hotely'); expect(totalLabel(0)).toBe('nalezeno 0 hotelů'); });
});
