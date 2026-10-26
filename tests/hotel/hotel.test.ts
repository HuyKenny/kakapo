import { beforeEach, describe, expect, it } from 'vitest';
import { loadHotel, hotelIsIndexable, hotelTitle, realDropPct, sparklineSvg, offerTerm, monthLabel, withinGrace, offersForHotel } from '../../src/lib/hotel';
import { autop } from '../../src/lib/hotel/text';
import { addHotel, addOffer, baseSeed, makeD1 } from './d1';

const NOW = '2026-10-26 12:00:00';
const TODAY = '2026-10-26';
const LONG = 'Apartmánový hotel v centru letoviska Amoudara, cca 400 metrů od písečné pláže. '.repeat(4);
let ctx: ReturnType<typeof makeD1>;
beforeEach(() => { ctx = makeD1(); baseSeed(ctx.raw); });
const opts = { now: NOW, today: TODAY, siteUrl: 'https://kakapo.cz' };
async function ok(slug: string, o = opts) { const r = await loadHotel(ctx.db, slug, o); if (!r || r.kind !== 'ok') throw new Error('expected ok, got ' + JSON.stringify(r)); return r.view; }

describe('loadHotel: lookup', () => {
  it('404 for unknown slug and for hidden hotel', async () => {
    addHotel(ctx.raw, { id: 1, slug: 'skryty', name: 'Skrytý', hidden: 1 });
    expect(await loadHotel(ctx.db, 'neexistuje', opts)).toBeNull();
    expect(await loadHotel(ctx.db, 'skryty', opts)).toBeNull();
  });
  it('redirect for a merged slug, gone for 410', async () => {
    addHotel(ctx.raw, { id: 1, slug: 'winner', name: 'Winner' });
    ctx.raw.exec(`INSERT INTO redirects (from_path,to_path,status,reason,created_at) VALUES ('/hotel/stary/','/hotel/winner/',301,'merge','x'),('/hotel/smazany/','/zajezdy/',410,'manual','x')`);
    expect(await loadHotel(ctx.db, 'stary', opts)).toEqual({ kind: 'redirect', to: '/hotel/winner/', status: 301 });
    expect(await loadHotel(ctx.db, 'smazany', opts)).toEqual({ kind: 'gone' });
  });
});

describe('loadHotel: offers and texts', () => {
  beforeEach(() => {
    addHotel(ctx.raw, { id: 1, slug: 'lino-mare', name: 'Lino Mare', description: LONG, images_json: '["https://img.fischer.cz/a.jpg","https://img.fischer.cz/b.jpg"]', min_price: 18000, offers_active: 3, partners_count: 2, rating: 8.4, rating_count: 12, lat: 35.3, lng: 25.1 });
    addOffer(ctx.raw, 1, { price_pp: 18000, departure_date: '2026-11-10', nights: 7, meal_type: 'snidane', airport: 'Brno' });
    addOffer(ctx.raw, 1, { price_pp: 24000, price_original: 30000, departure_date: '2026-12-01', nights: 10, partner_slug: 'invia', feed_id: 2, airport: 'Praha', is_last_minute: 1 });
    addOffer(ctx.raw, 1, { price_pp: 21000, departure_date: '2026-12-20', nights: 7, partner_slug: 'cedok', feed_id: 3, airport: 'Praha' });
    addOffer(ctx.raw, 1, { price_pp: 5000, departure_date: '2026-10-01' }); // past -> excluded
    addOffer(ctx.raw, 1, { price_pp: 4000, active: 0 }); // inactive -> excluded
  });
  it('lists only active future offers, cheapest first, with go links', async () => {
    const v = await ok('lino-mare');
    expect(v.offers.map((o) => o.price_pp)).toEqual([18000, 21000, 24000]);
    expect(v.offersLabel).toBe('3 nabídky');
    expect(v.offers[0]!.go_url).toMatch(/^\/go\/\d+\/\?ctx=hotel-detail$/);
    expect(v.offers[2]!.discount).toBe(20);
    expect(v.nearest).toBe('2026-11-10');
    expect(v.soldOut).toBe(false);
  });
  it('computes fit, check points and FAQs only from data', async () => {
    const v = await ok('lino-mare');
    expect(v.fitPoints).toContain('4hvězdičkové ubytování pro cestovatele, kteří chtějí lepší hotelové zázemí.');
    expect(v.fitPoints.some((f) => f.startsWith('Hosté hotel hodnotí 8,4/10 z 12 hodnocení'))).toBe(true);
    expect(v.fitPoints).toContain('Na výběr jsou pobyty na 7 nocí a 10 nocí.');
    expect(v.checkPoints.some((c) => c.startsWith('Cena se mezi termíny liší o 33 %'))).toBe(true);
    expect(v.checkPoints.some((c) => c.includes('Odlety jsou z více letišť (Brno a Praha)'))).toBe(true);
    expect(v.checkPoints.some((c) => c.startsWith('Hotel nabízí 3 cestovní kanceláře (Exim'))).toBe(false);
    const qs = v.faqs.map((f) => f.q);
    expect(qs).toContain('Kolik stojí Lino Mare?');
    expect(qs).toContain('Kdy je Lino Mare nejlevnější?');
    expect(qs).toContain('Jaká strava je v Lino Mare v ceně?');
    expect(v.faqs.find((f) => f.q.startsWith('Kolik'))!.a).toContain('od 18 000 Kč za osobu; nejdražší');
  });
  it('builds months with the cheapest flagged and labels without current year', async () => {
    const v = await ok('lino-mare');
    expect(v.months.map((m) => m.ym)).toEqual(['2026-11', '2026-12']);
    expect(v.months[0]).toMatchObject({ label: 'listopad', mp: 18000, cheapest: true });
    expect(monthLabel('2027-01', 2026)).toBe('leden 2027');
  });
  it('meta: title budget, description, robots and canonical', async () => {
    const v = await ok('lino-mare');
    expect(v.meta.title).toBe('Lino Mare ceny 2026 — Kréta, Řecko | Kakapo.cz');
    expect(v.meta.title.length).toBeLessThanOrEqual(60);
    expect(v.meta.description).toMatch(/^Hotel Lino Mare \(Kréta, Řecko\) od 18 000 Kč — 3 nabídky\. Porovnejte ceny, termíny a stravu od CK Fischer, Čedok a Invia\. Hodnocení 8,4\/10\./);
    expect(v.meta.description.length).toBeLessThanOrEqual(158);
    expect(v.meta.robots).toEqual(['index', 'follow']);
    expect(v.meta.canonical).toBe('https://kakapo.cz/hotel/lino-mare/');
    expect(v.meta.image).toBe('https://img.fischer.cz/a.jpg');
  });
  it('JSON-LD graph: breadcrumb, Hotel with AggregateOffer + rating, WebPage, FAQPage', async () => {
    const g = ((await ok('lino-mare')).meta.jsonLd[0] as any)['@graph'] as any[];
    expect(g.map((x) => x['@type'])).toEqual(['BreadcrumbList', 'Hotel', 'WebPage', 'FAQPage']);
    const hotel = g[1];
    expect(hotel.address.addressCountry).toBe('GR');
    expect(hotel.makesOffer).toMatchObject({ '@type': 'AggregateOffer', lowPrice: '18000', offerCount: '3', highPrice: '24000' });
    expect(hotel.aggregateRating).toMatchObject({ ratingValue: '8.4', ratingCount: 12, bestRating: '10' });
    expect(hotel.starRating.ratingValue).toBe('4');
    expect(g[0].itemListElement.at(-1)).toMatchObject({ name: 'Lino Mare' });
    expect(g[0].itemListElement.at(-1).item).toBeUndefined();
  });
  it('API sort/month helpers', async () => {
    expect((await offersForHotel(ctx.db, 1, 'departure', '', TODAY)).map((o) => o.departure_date)[0]).toBe('2026-11-10');
    expect((await offersForHotel(ctx.db, 1, 'nights', '', TODAY))[0]!.nights).toBe(10);
    expect((await offersForHotel(ctx.db, 1, 'discount', '', TODAY))[0]!.price_original).toBe(30000);
    expect((await offersForHotel(ctx.db, 1, 'price', '2026-12', TODAY)).map((o) => o.price_pp)).toEqual([21000, 24000]);
    expect(await offersForHotel(ctx.db, 1, 'price', '2027-01', TODAY)).toEqual([]);
  });
});

describe('sold out + grace + indexability', () => {
  it('sold-out hotel shows last known price, nearby alternatives and a grace-based description', async () => {
    addHotel(ctx.raw, { id: 1, slug: 'bez-nabidky', name: 'Bez nabídky', description: LONG, offers_active: 0, offers_last_seen: '2026-09-01 02:00:00' });
    ctx.raw.exec(`INSERT INTO price_history (hotel_id,snap_date,min_price) VALUES (1,'2026-08-01',15000),(1,'2026-09-01',17000)`);
    for (const i of [2, 3, 4]) {
      addHotel(ctx.raw, { id: i, slug: `soused-${i}`, name: `Soused ${i}`, description: LONG, offers_active: 1, min_price: 10000 + i });
      addOffer(ctx.raw, i);
    }
    const v = await ok('bez-nabidky');
    expect(v.soldOut).toBe(true);
    expect(v.offers).toEqual([]);
    expect(v.lastKnown).toEqual({ price: 17000, date: '2026-09-01' });
    expect(v.nearby).toHaveLength(3);
    expect(v.meta.robots).toEqual(['index', 'follow']);
    expect(v.meta.description).toBe('Hotel Bez nabídky (Kréta, Řecko) — aktuálně bez volných termínů. Naposledy od 17 000 Kč. Ukážeme vývoj ceny a hotely se stejnou destinací, které termíny mají.');
    expect(v.sparkline).toContain('<polyline');
    expect(v.descriptionParas.length).toBeGreaterThan(0);
  });
  it('noindex when out of the 180-day grace, or without text and image', async () => {
    expect(withinGrace('2026-04-01 00:00:00', NOW)).toBe(false);
    expect(withinGrace('2026-05-01 00:00:00', NOW)).toBe(true);
    expect(hotelIsIndexable(0, LONG, '[]', '2026-04-01 00:00:00', NOW)).toBe(false);
    expect(hotelIsIndexable(0, LONG, '[]', null, NOW)).toBe(false);
    expect(hotelIsIndexable(2, 'krátký', '[]', null, NOW)).toBe(false);
    expect(hotelIsIndexable(2, 'krátký', '["https://x/a.jpg"]', null, NOW)).toBe(true);
    addHotel(ctx.raw, { id: 1, slug: 'stary', name: 'Starý', description: LONG, offers_active: 0, offers_last_seen: '2026-02-01 00:00:00' });
    expect((await ok('stary')).meta.robots).toEqual(['noindex', 'follow']);
  });
  it('description fallback when the feed has none, and related links', async () => {
    addHotel(ctx.raw, { id: 1, slug: 'bez-popisu', name: 'Bez popisu', description: '', offers_active: 1, min_price: 20000 });
    addOffer(ctx.raw, 1);
    const v = await loadHotel(ctx.db, 'bez-popisu', { ...opts, longtailLink: async (c, d, t) => (t === 'all-inclusive' ? { h1: `${c} ${d} all inclusive`, path: `/${c}/${d ? d + '/' : ''}ai/` } : null) });
    if (!v || v.kind !== 'ok') throw new Error('x');
    expect(v.view.descriptionParas[0]).toBe('Bez popisu se nachází v lokalitě Amoudara, Kréta, Řecko. Na Kakapo.cz u hotelu porovnáváme 1 nabídka s cenou od 20 000 Kč za osobu.');
    expect(v.view.descriptionParas[1]).toBe('V dostupných termínech najdete 4hvězdičkové ubytování, pobyty na 7 nocí, strava: All inclusive, odlety z Praha.');
    expect(v.view.relatedLinks.map((l) => l[1])).toEqual(['/recko/', '/recko/ai/', '/recko/kreta/', '/recko/kreta/ai/', '/dovolena-u-more-all-inclusive/', '/last-minute-all-inclusive/']);
    expect(v.view.relatedLinks[0]).toEqual(['Dovolená Řecko', '/recko/']);
    expect(v.view.relatedLinks.at(-1)).toEqual(['Last minute all inclusive', '/last-minute-all-inclusive/']);
  });
});

describe('pure helpers', () => {
  it('hotelTitle respects the 60 char budget', () => {
    expect(hotelTitle('Lino Mare', 'Kréta, Řecko', 2026)).toBe('Lino Mare ceny 2026 — Kréta, Řecko | Kakapo.cz');
    expect(hotelTitle('A'.repeat(70), 'x', 2026).length).toBeLessThanOrEqual(60);
    expect(hotelTitle('Velmi dlouhý název hotelu s mnoha slovy v názvu pro test', 'Kréta, Řecko', 2026).length).toBeLessThanOrEqual(60);
  });
  it('realDropPct needs ≥5 %, ≥300 Kč and ≤7 days', () => {
    const base = { prev_price_pp: 20000, price_pp: 18000, price_changed_at: '2026-10-24 10:00:00' };
    expect(realDropPct(base, NOW)).toBe(10);
    expect(realDropPct({ ...base, price_pp: 19800 }, NOW)).toBe(0);
    expect(realDropPct({ ...base, price_changed_at: '2026-10-10 10:00:00' }, NOW)).toBe(0);
    expect(realDropPct({ ...base, prev_price_pp: 0 }, NOW)).toBe(0);
  });
  it('offerTerm omits the departure year when equal', () => {
    expect(offerTerm('2026-10-19', '2026-10-24')).toBe('19. 10. – 24. 10. 2026');
    expect(offerTerm('2026-12-28', '2027-01-04')).toBe('28. 12. 2026 – 4. 1. 2027');
    expect(offerTerm('2026-10-19', null)).toBe('19. 10. 2026');
  });
  it('sparkline needs two points; autop escapes', () => {
    expect(sparklineSvg([{ d: '2026-09-01', p: 100 }])).toBe('');
    expect(sparklineSvg([{ d: '2026-09-01', p: 100 }, { d: '2026-09-02', p: 120 }])).toContain('<circle');
    expect(autop('a & b\n\nc')).toBe('<p>a &amp; b</p>\n<p>c</p>');
  });
});
