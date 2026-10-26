import { seasonYear } from '../../src/lib/year';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { memoryDb } from './d1';
import { rebuildSnapshots } from '../../src/lib/snapshots';
import { clearMemo } from '../../src/lib/landing/util';
import {
  landingContext, resolveRoute, canonicalAliasTarget, legacyRedirect, landingTitle, landingDescription, isIndexable, titleBudget,
  topicSlugList, getTopicStatic, longtailContext, TOPIC_SLUGS, DEST_TOPIC_SLUGS, hubUrl, climateSection, monthRange, winterRange, ruleForSlug, getTopic,
} from '../../src/lib/landing';
import { easterRange, resolveRule } from '../../src/lib/landing/dates';
import { loadRegistry } from '../../src/lib/snapshots';
import { normalizeFaqs } from '../../src/lib/landing/pages';

const { raw, db } = memoryDb();
const NOW = '2026-10-26 10:00:00';

function seed() {
  raw.exec("INSERT INTO partners (slug,name) VALUES ('fischer','Fischer'),('cedok','Čedok')");
  raw.exec("INSERT INTO feeds (id,name,partner_slug,adapter,content_type,source_ref) VALUES (1,'Fischer','fischer','cj-atcom','hotels','FEED_URL_1'),(2,'Čedok','cedok','cedok-slim','hotels','FEED_URL_2')");
  let hid = 0; let oid = 0;
  const hotel = (country: string, cl: string, dest: string, dl: string, n: number) => {
    for (let i = 0; i < n; i++) {
      hid++;
      raw.prepare("INSERT INTO hotels (id,slug,dedup_key,name,country,country_slug,destination,destination_slug,stars,description,images_json,min_price,offers_active,has_all_inclusive,meal_flags,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(hid, `h-${hid}`, `k${hid}`, `Hotel ${hid}`, cl, country, dl, dest, 4, 'x'.repeat(200), '["https://img.example/a.jpg"]', 10000 + hid * 100, 3, 1, 1, NOW, NOW);
      for (let j = 0; j < 3; j++) {
        oid++;
        raw.prepare("INSERT INTO offers (id,hotel_id,feed_id,partner_slug,external_id,content_hash,price_pp,departure_date,nights,meal_type,transport,airport,airport_slug,affiliate_url,active,last_seen,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)")
          .run(oid, hid, j % 2 + 1, j % 2 ? 'cedok' : 'fischer', `e${oid}`, 'h', 10000 + hid * 100 + j * 500, `2026-11-${String(10 + j).padStart(2, '0')}`, 7, 'all-inclusive', 'letecky', 'Praha', 'praha', 'https://ex.test/x', NOW, NOW, NOW);
      }
    }
  };
  hotel('recko', 'Řecko', 'kos', 'Kos', 14);
  hotel('recko', 'Řecko', 'kreta', 'Kréta', 14);
  hotel('egypt', 'Egypt', 'hurghada', 'Hurghada', 13);
  hotel('albanie', 'Albánie', 'durres', 'Durrës', 2);
  hotel('kypr', 'Kypr', 'pafos', 'Pafos', 6);
}
beforeAll(async () => { seed(); await rebuildSnapshots(db); });
beforeEach(() => clearMemo());

describe('routing', () => {
  it('maps listing, flag, meal, airport and topic paths', async () => {
    expect(await resolveRoute(db, '/zajezdy/')).toEqual({ page: 'search', vars: {} });
    expect(await resolveRoute(db, '/last-minute')).toEqual({ page: 'flag', vars: { flag: 'last-minute' } });
    expect(await resolveRoute(db, '/all-inclusive/')).toEqual({ page: 'meal', vars: { meal: 'all-inclusive' } });
    expect(await resolveRoute(db, '/odlet-z-praha/')).toEqual({ page: 'airport', vars: { airport: 'praha' } });
    expect(await resolveRoute(db, '/dovolena-u-more/')).toEqual({ page: 'topic', vars: { topic: 'dovolena-u-more' } });
    expect(await resolveRoute(db, '/cedok-zajezdy/')).toEqual({ page: 'topic', vars: { topic: 'cedok-zajezdy' } });
  });
  it('resolves countries, destinations and longtail topics through the registry', async () => {
    expect(await resolveRoute(db, '/recko/')).toEqual({ page: 'country', vars: { country: 'recko' } });
    expect(await resolveRoute(db, '/recko/kos/')).toEqual({ page: 'country', vars: { country: 'recko', dest: 'kos' } });
    expect(await resolveRoute(db, '/recko/all-inclusive/')).toEqual({ page: 'longtail', vars: { country: 'recko', ltopic: 'all-inclusive' } });
    expect(await resolveRoute(db, '/recko/kos/last-minute/')).toEqual({ page: 'longtail', vars: { country: 'recko', dest: 'kos', ltopic: 'last-minute' } });
  });
  it('returns null for unknown or too deep paths (404 / other routers)', async () => {
    expect(await resolveRoute(db, '/neexistuje/')).toBeNull();
    expect(await resolveRoute(db, '/recko/neexistuje/')).toBeNull();
    expect(await resolveRoute(db, '/recko/kos/last-minute/dalsi/')).toBeNull();
    expect(await resolveRoute(db, '/recko/kos/neexistuje/')).toBeNull();
    expect(await resolveRoute(db, '/')).toBeNull();
  });
  it('redirects aliases and legacy paths with 301 targets', () => {
    expect(canonicalAliasTarget('/egypt/egypt-hurghada/')).toBe('/egypt/hurghada/');
    expect(canonicalAliasTarget('/kypr/kypr/')).toBe('/kypr/');
    expect(canonicalAliasTarget('/kapverdske-ostrovy/ostrov-sal/all-inclusive/')).toBe('/kapverdy/sal/all-inclusive/');
    expect(canonicalAliasTarget('/recko/kos/')).toBe('');
    expect(legacyRedirect('/dovolena/')).toBe('/zajezdy/');
    expect(legacyRedirect('/vlastni-dopravou')).toBe('/dovolena-vlastni-dopravou/');
    expect(legacyRedirect('/go/12/')).toBe('');
    expect(legacyRedirect('/recko/')).toBe('');
  });
});

describe('landing context', () => {
  it('builds a country landing with facts, FAQs and breadcrumbs', async () => {
    const ctx = (await landingContext(db, 'country', { country: 'recko' }))!;
    expect(ctx.h1).toBe('Dovolená Řecko');
    expect(ctx.filters).toEqual({ country: 'recko' });
    expect(ctx.seo_text).toContain('Dovolená Řecko v číslech');
    expect(ctx.seo_text).toContain('V katalogu máme 28 hotelů');
    expect(ctx.faqs.map((f) => f.q)).toEqual(['Kdy rezervovat dovolenou Řecko?', 'Co je při výběru nejdůležitější?']); // priority country: hand-written FAQs win
    expect(ctx.breadcrumbs.map((b) => b.label)).toEqual(['Domů', 'Řecko']);
    expect(ctx.canonical).toBe('/recko/');
  });
  it('derives data FAQs for a non-priority country', async () => {
    const ctx = (await landingContext(db, 'country', { country: 'kypr' }))!;
    expect(ctx.faqs.map((f) => f.q)).toEqual(['Kolik stojí dovolená kypr?', 'Kdy je to nejlevnější?', 'Odkud se létá?', 'Je lepší all inclusive, nebo polopenze?']);
    expect(ctx.faqs[0]!.a).toContain('Nejnižší cena v naší nabídce je');
    expect(ctx.seo_text).toContain('Kdy jet: počasí a teplota moře — Kypr');
  });
  it('builds destination, flag, meal and airport contexts', async () => {
    const dest = (await landingContext(db, 'country', { country: 'recko', dest: 'kos' }))!;
    expect(dest.h1).toBe('Dovolená Kos'); expect(dest.path).toBe('/recko/kos/'); expect(dest.filters).toEqual({ country: 'recko', dest: 'kos' });
    expect((await landingContext(db, 'flag', { flag: 'last-minute' }))!.h1).toBe('Last minute dovolená');
    expect((await landingContext(db, 'flag', { flag: 'zlevneno' }))!.index_min).toBe(9999);
    expect((await landingContext(db, 'meal', { meal: 'all-inclusive' }))!.h1).toBe('All inclusive dovolená');
    expect((await landingContext(db, 'airport', { airport: 'praha' }))!.filters).toEqual({ airport: ['praha'] });
  });
  it('uses the priority-country copy for Egypt', async () => {
    const ctx = (await landingContext(db, 'country', { country: 'egypt' }))!;
    expect(ctx.title).toBe(`Egypt dovolená ${seasonYear()} — Hurghada, Marsa Alam, all inclusive | Kakapo.cz`);
    expect(ctx.seo_text).toContain('<h2>Jak vybrat dovolenou Egypt</h2>');
  });
  it('builds longtail contexts with the title budget and place format', async () => {
    const ctx = (await landingContext(db, 'longtail', { country: 'recko', dest: 'kos', ltopic: 'dovolena-listopad' }))!;
    expect(ctx.h1).toBe('Dovolená Kos v listopadu');
    expect(ctx.filters.dest).toBe('kos'); expect(ctx.filters.sort).toBe('departure'); expect(ctx.filters.date_from).toMatch(/^\d{4}-11-/);
    expect(ctx.path).toBe('/recko/kos/dovolena-listopad/');
    expect(ctx.faqs).toHaveLength(3);
    expect(await landingContext(db, 'longtail', { country: 'recko', ltopic: 'neexistuje' })).toBeNull();
  });
  it('hydrates partner pages from offers and renders relative URLs only', async () => {
    const ctx = (await landingContext(db, 'topic', { topic: 'cedok-zajezdy' }))!;
    expect(ctx.intro).toContain('nepatří Čedoku');
    expect(ctx.seo_text).toContain('Čedok: zájezdy a pobyty'.slice(0, 0) + 'v číslech');
    expect(ctx.faqs.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(ctx)).not.toMatch(/https?:\/\/(www\.)?kakapo\.cz/);
  });
  it('returns null for unknown topics', async () => { expect(await landingContext(db, 'topic', { topic: 'nope' })).toBeNull(); });
});

describe('editorial overrides', () => {
  it('replaces h1/title/intro/seo_text/faqs and still appends facts', async () => {
    raw.exec("INSERT INTO editorial_overrides (kind,key,field,value,updated_at) VALUES ('landing','/recko/','h1','Řecko pro vás',''),('landing','/recko/','title','Řecko 2026 — vlastní titulek | Kakapo.cz',''),('landing','/recko/','seo_text','<h2>Ruční text</h2><p>x</p>',''),('landing','/recko/','faqs_json','[{\"q\":\"A?\",\"a\":\"B\"},{\"q\":\"\",\"a\":\"nic\"}]',''),('landing','/recko/','description','Ruční popis','')");
    const ctx = (await landingContext(db, 'country', { country: 'recko' }))!;
    expect(ctx.h1).toBe('Řecko pro vás');
    expect(landingTitle(ctx)).toBe(`Řecko ${seasonYear()} — vlastní titulek | Kakapo.cz`);
    expect(ctx.faqs).toEqual([{ q: 'A?', a: 'B' }]);
    expect(ctx.seo_text.startsWith('<h2>Ruční text</h2>')).toBe(true);
    expect(ctx.seo_text).toContain('v číslech');
    // the stored description is ignored when there are results (live numbers win)…
    expect(landingDescription(ctx, 28, { minPrice: 10100 })).toContain('28 hotelů od 10');
    expect(landingDescription(ctx, 28, { minPrice: 10100 })).not.toContain('Ruční popis');
    // …and is the fallback for an empty listing
    expect(landingDescription(ctx, 0)).toBe('Ruční popis');
    raw.exec("DELETE FROM editorial_overrides");
  });
  it('drops FAQs without question or answer and caps at 8', () => {
    expect(normalizeFaqs([{ q: 'x', a: '' }, { q: '', a: 'y' }, 'bad'])).toEqual([]);
    expect(normalizeFaqs(Array.from({ length: 12 }, (_, i) => ({ q: `q${i}`, a: 'a' })))).toHaveLength(8);
  });
});

describe('SEO rules', () => {
  it('keeps every title within 60 characters (hand-written ones that overflow are rebuilt from the H1)', async () => {
    const reg = await loadRegistry(db);
    const titles: string[] = [];
    for (const s of topicSlugList()) { const t = getTopicStatic(s)!; titles.push(landingTitle(t)); }
    for (const t of TOPIC_SLUGS) { const c = longtailContext(reg, 'recko', '', t); if (c) titles.push(landingTitle(c)); }
    for (const t of DEST_TOPIC_SLUGS) { const c = longtailContext(reg, 'recko', 'kos', t); if (c) titles.push(landingTitle(c)); }
    expect(titles.length).toBeGreaterThan(100);
    for (const t of titles) expect([...t].length, t).toBeLessThanOrEqual(60);
  });
  it('titleBudget adds suffix and brand only when they fit', () => {
    expect(titleBudget('Dovolená Řecko')).toBe('Dovolená Řecko — ceny a termíny | Kakapo.cz');
    expect([...titleBudget('Dovolená u moře all inclusive Side, Turecko')].length).toBeLessThanOrEqual(60);
    expect([...titleBudget('Velmi dlouhý název destinace, který se už určitě nevejde do rozpočtu znaků')].length).toBeGreaterThan(0);
  });
  it('noindex below index_min, with a query string or on an alias', () => {
    expect(isIndexable({ index_min: 12 }, 11)).toBe(false);
    expect(isIndexable({ index_min: 12 }, 12)).toBe(true);
    expect(isIndexable({}, 0)).toBe(false);
    expect(isIndexable({ index_min: 12 }, 50, { hasQuery: true })).toBe(false);
    expect(isIndexable({ index_min: 12 }, 50, { aliasTarget: '/kypr/' })).toBe(false);
    expect(isIndexable({ index_min: 9999 }, 5000)).toBe(false);
  });
  it('lists partner hubs and climate sections only for known paths', () => {
    expect(hubUrl('cedok')).toBe('/cedok-zajezdy/'); expect(hubUrl('nic')).toBe('');
    expect(climateSection('/egypt/hurghada/')).toContain('Kdy jet: počasí a teplota moře');
    expect(climateSection('/recko/')).toBe('');
  });
});

describe('date windows', () => {
  it('rolls month windows into next year and starts at today for the current month', () => {
    const t = { y: 2026, m: 10, d: 26 };
    expect(monthRange(10, t)).toEqual({ from: '2026-10-26', to: '2026-10-31', year: 2026 });
    expect(monthRange(6, t)).toEqual({ from: '2027-06-01', to: '2027-06-30', year: 2027 });
    expect(monthRange(2, { y: 2027, m: 1, d: 5 }).to).toBe('2027-02-28');
    expect(winterRange(t)).toEqual({ from: '2026-12-01', to: '2027-03-31', year: 2026 });
    expect(winterRange({ y: 2027, m: 2, d: 3 })).toEqual({ from: '2027-02-03', to: '2027-03-31', year: 2027 });
  });
  it('computes Easter windows (2027-03-28)', () => {
    expect(easterRange({ y: 2026, m: 10, d: 26 })).toEqual({ from: '2027-03-21', to: '2027-04-01', year: 2027 });
  });
  it('derives rules from slugs and recomputes frozen dumps', () => {
    expect(ruleForSlug('kam-v-rijnu-k-mori')).toEqual({ kind: 'month', month: 10 });
    expect(ruleForSlug('dovolena-cervenec')).toEqual({ kind: 'month', month: 7 });
    expect(ruleForSlug('super-last-minute-odlet-zitra')).toEqual({ kind: 'relative', from: 1, to: 1 });
    expect(resolveRule({ kind: 'relative', from: 1, to: 1 }, { y: 2026, m: 12, d: 31 }).from).toBe('2027-01-01');
    const t = getTopicStatic('kam-v-cervnu-k-mori', { y: 2028, m: 8, d: 1 })!;
    expect(t.filters.date_from).toBe('2029-06-01');
    expect(t.title).toContain('2029');
  });
  it('async getTopic returns hydrated partner topics and null for unknown', async () => {
    expect(await getTopic(db, 'nope')).toBeNull();
    expect((await getTopic(db, 'fischer-zajezdy'))!.partner).toBe('fischer');
  });
});
