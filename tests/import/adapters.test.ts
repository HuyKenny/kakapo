import { describe, expect, it } from 'vitest';
import { addFeed, dovolenaXml, makeHarness, manyHotels, one, rows, serve, tickAll, FEED_HOST, NOW } from './helpers';
import { mapCjHotel, mapCjProduct, cjQuery, type CjProduct } from '../../workers/import/src/adapters/cj';
import { hostAllowed, openHttp } from '../../workers/import/src/adapters/http';
import { buildAffiliateUrl } from '../../workers/import/src/adapters/normalize';
import { categorize } from '../../workers/import/src/adapters/categories';
import { handle } from '../../workers/import/src/index';
import { runDaily } from '../../workers/import/src/engine/daily';
import { nextRunAt, parseWindow, windowOpen } from '../../workers/import/src/engine/schedule';

const cj = (link: string, over: Partial<CjProduct> = {}): CjProduct => ({ id: '77', title: 'Hotel Sol', description: 'Pobyt s all inclusive', link, imageLink: 'https://img.example.test/a.jpg', price: { amount: 24490, currency: 'CZK' }, linkCode: { clickUrl: 'https://www.kqzyfj.com/click-1-2?url=https%3A%2F%2Fexample.test%2Fx&cjsku=77' }, ...over });

describe('CJ per-partner parsers', () => {
  it('atcom (Fischer/Exim): country, destination, city, giata, meal, nights, dates from the URL', () => {
    const m = mapCjHotel(cj('https://www.fischer.cz/recko/kreta-heraklion/amoudara/lino-mare?GIATA=418098&DI=BB&NN=7&DD=2027-01-23&RD=2027-01-30'), 'atcom')!;
    expect(m.hotel).toMatchObject({ country: 'Řecko', destination: 'Kreta Heraklion', city: 'Amoudara', giata_id: 418098 });
    expect(m.offers[0]).toMatchObject({ meal_type: 'snidane', nights: 7, departure_date: '2027-01-23', return_date: '2027-01-30', price_pp: 24490, external_id: '77' });
  });
  it('bluestyle: rating from customLabel1, date, duration and meal from room1', () => {
    const m = mapCjHotel(cj('https://www.blue-style.cz/egypt/hurghada/hotel-x/?date=2027-02-10&duration=4&room1=2|SR|HB', { customLabel1: '82' }), 'bluestyle')!;
    expect(m.hotel).toMatchObject({ country: 'Egypt', destination: 'Hurghada', rating: 8.2 });
    expect(m.offers[0]).toMatchObject({ departure_date: '2027-02-10', nights: 4, meal_type: 'polopenze' });
  });
  it('tui: airport, dates and nights from the offer code', () => {
    const m = mapCjHotel(cj('https://www.tui.cz/dovolena/turecko/antalya/hotel-sun-1234/OfferCodeWS/PRGAYT20270114ZZ20270114202701211L07XX'), 'tui')!;
    expect(m.hotel).toMatchObject({ country: 'Turecko', destination: 'Antalya' });
    expect(m.offers[0]).toMatchObject({ airport: 'Praha', departure_date: '2027-01-14', return_date: '2027-01-21', nights: 7 });
  });
  it('sale price wins and the list price becomes the original price; deleted / dateless / priceless products are dropped', () => {
    const m = mapCjHotel(cj('https://www.fischer.cz/recko/a/b/c?DD=2027-01-23', { salePrice: { amount: 19990 } }), 'atcom')!;
    expect(m.offers[0]).toMatchObject({ price_pp: 19990, price_original: 24490 });
    expect(mapCjHotel(cj('https://www.fischer.cz/recko/a/b/c?DD=2027-01-23', { isDeleted: true }), 'atcom')).toBeNull();
    expect(mapCjHotel(cj('https://www.fischer.cz/recko/a/b/c'), 'atcom')).toBeNull();
    expect(mapCjHotel(cj('https://www.fischer.cz/recko/a/b/c?DD=2027-01-23', { price: { amount: 0 } }), 'atcom')).toBeNull();
  });
  it('spa products: city, nights and type from the title', () => {
    const p = mapCjProduct(cj('https://spa.example.test/x', { title: 'Romantický víkend v Mariánských Lázních na 2 noci' }), 'spa')!;
    expect(p).toMatchObject({ place: 'Mariánské Lázně', nights: 2, type_raw: 'Romantický pobyt', country: 'Česko' });
  });
  it('GraphQL query only accepts numeric ids (no injection through the feed config)', () => {
    expect(() => cjQuery({ ad_id: '1" }) { x' }, { token: 't', cid: '1', pid: '2' }, 0, 10)).toThrow();
    expect(cjQuery({ partner_id: '5525941' }, { token: 't', cid: '1', pid: '2' }, 500, 500)).toContain('partnerIds: ["5525941"]');
  });

  it('end to end: CJ feed pages through the API, imports hotels and offers; the token never leaves the Authorization header', async () => {
    const h = makeHarness({ CJ_API_TOKEN: 'cj-secret-token', CJ_CID: '123', CJ_PID: '456' });
    addFeed(h, { id: 1, partner: 'fischer', adapter: 'cj-atcom', mapping: { source: 'cj', ad_id: '15082725', parser: 'atcom' }, kind: 'cj' });
    const all = Array.from({ length: 30 }, (_, i) => cj(`https://www.fischer.cz/recko/kreta/hersonissos/hotel-${i}?GIATA=${1000 + i}&DI=AI&NN=7&DD=2027-01-23&RD=2027-01-30`, { id: String(i), title: `Hotel ${i}` }));
    const calls: Array<{ query: string; auth: string }> = [];
    h.routes.set('ads.api.cj.com/query', async (_u, init) => {
      const body = JSON.parse(String(init?.body)); calls.push({ query: body.query, auth: new Headers(init?.headers).get('authorization')! });
      const offset = Number(/offset: (\d+)/.exec(body.query)![1]);
      return Response.json({ data: { products: { totalCount: all.length, resultList: all.slice(offset, offset + 500) } } });
    });
    const r = (await tickAll(h)).at(-1)!;
    expect(r.status).toBe('ok');
    expect(rows(h, 'SELECT * FROM hotels')).toHaveLength(30);
    expect(rows(h, 'SELECT affiliate_url FROM offers')[0]!.affiliate_url).toContain('kqzyfj.com/click-1-2?url=https%3A%2F%2Fexample.test%2Fx&cjsku=77'); // tracking link untouched
    expect(calls[0]!.auth).toBe('Bearer cj-secret-token');
    expect(JSON.stringify([h.logs, rows(h, 'SELECT message FROM import_runs')])).not.toContain('cj-secret-token');
  });
  it('CJ without secrets fails with a clear message and touches nothing', async () => {
    const h = makeHarness();
    addFeed(h, { id: 1, partner: 'fischer', adapter: 'cj-atcom', mapping: { ad_id: '1', parser: 'atcom' }, kind: 'cj' });
    const r = (await tickAll(h)).at(-1)!;
    expect(r.status).toBe('failed'); expect(r.message).toMatch(/CJ secrets/);
  });
});

describe('HTTP download policy', () => {
  const mk = () => makeHarness({ ALLOWED_FEED_HOSTS: `${FEED_HOST},*.partner.test` });
  it('allow-list matching', () => {
    expect(hostAllowed('a.partner.test', '*.partner.test')).toBe(true); expect(hostAllowed('partner.test', '*.partner.test')).toBe(false); expect(hostAllowed('evil.test', 'a.test')).toBe(false); expect(hostAllowed('x', undefined)).toBe(false);
  });
  it('rejects IP literals and hosts outside the list; a configured http:// URL is fetched over https', async () => {
    const h = mk();
    for (const url of ['https://10.0.0.5/f', 'https://127.0.0.1/f', 'https://evil.example/f', 'http://evil.example/f']) await expect(openHttp(h.deps, url, {}, { attempts: 1 })).rejects.toMatchObject({ retryable: false });
    expect(h.fetchLog).toHaveLength(0);
    h.routes.set(`${FEED_HOST}/plain`, () => new Response('<a/>'));
    expect((await openHttp(h.deps, `http://${FEED_HOST}/plain`, {}, { attempts: 1 })).status).toBe('ok');
  });
  it('refuses a redirect that downgrades to http', async () => {
    const h = mk();
    h.routes.set(`${FEED_HOST}/down`, () => new Response(null, { status: 302, headers: { location: `http://${FEED_HOST}/x` } }));
    await expect(openHttp(h.deps, `https://${FEED_HOST}/down`, {}, { attempts: 1 })).rejects.toThrow(/https/);
  });
  it('follows redirects only to allowed hosts (SSRF through a redirect is blocked)', async () => {
    const h = mk();
    h.routes.set(`${FEED_HOST}/ok`, () => new Response(null, { status: 302, headers: { location: 'https://cdn.partner.test/real.xml' } }));
    h.routes.set('cdn.partner.test/real.xml', () => new Response('<a/>'));
    const good = await openHttp(h.deps, `https://${FEED_HOST}/ok`, {}, { attempts: 1 });
    expect(good.status).toBe('ok');
    h.routes.set(`${FEED_HOST}/bad`, () => new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } }));
    await expect(openHttp(h.deps, `https://${FEED_HOST}/bad`, {}, { attempts: 1 })).rejects.toThrow(/not a public name|allow-list/);
    h.routes.set(`${FEED_HOST}/loop`, () => new Response(null, { status: 302, headers: { location: `https://${FEED_HOST}/loop` } }));
    await expect(openHttp(h.deps, `https://${FEED_HOST}/loop`, {}, { attempts: 1 })).rejects.toThrow(/too many redirects/);
  });
  it('retries 5xx / 429 but not 4xx', async () => {
    const h = mk(); let n = 0;
    h.routes.set(`${FEED_HOST}/flaky`, () => (++n < 3 ? new Response('x', { status: 503 }) : new Response('<a/>')));
    expect((await openHttp(h.deps, `https://${FEED_HOST}/flaky`, {})).status).toBe('ok'); expect(n).toBe(3);
    let m = 0; h.routes.set(`${FEED_HOST}/gone`, () => { m++; return new Response('x', { status: 404 }); });
    await expect(openHttp(h.deps, `https://${FEED_HOST}/gone`, {})).rejects.toThrow(/HTTP 404/); expect(m).toBe(1);
  });
  it('affiliate url builder: params, {url} templates and untouched tracking links', () => {
    expect(buildAffiliateUrl('https://p.test/a?x=1', 'utm_source=kakapo')).toBe('https://p.test/a?x=1&utm_source=kakapo');
    expect(buildAffiliateUrl('https://p.test/a', '?aff=7')).toBe('https://p.test/a?aff=7');
    expect(buildAffiliateUrl('https://p.test/a?x=1', 'https://track.test/r?u={url}&id=5')).toBe('https://track.test/r?u=https%3A%2F%2Fp.test%2Fa%3Fx%3D1&id=5');
    expect(buildAffiliateUrl('javascript:alert(1)', '')).toBe(''); expect(buildAffiliateUrl('', 'a=1')).toBe('');
    const signed = 'https://www.kqzyfj.com/click-1-2?url=https%3A%2F%2Fx.test%2F%3Fa%3D1%26b%3D2&sig=A%2Bb%3D';
    expect(buildAffiliateUrl(signed, '')).toBe(signed);
  });
});

describe('product feeds', () => {
  const tours = (extra = '') => `<?xml version="1.0"?><tours>
    <tour><tour_id>1</tour_id><tour_title>Okruh Itálií</tour_title><tour_desc>Poznávací okruh</tour_desc><tour_detail_url>https://p.test/t/1</tour_detail_url><tour_type>200</tour_type><locations><location><country_id>ITA</country_id><area_title>Sicílie</area_title><place_title>Palermo</place_title></location></locations><photos><photo><url>https://img.test/1.jpg</url></photo></photos><term_groups><term_group><terms><term><start>2026-12-10</start><end>2026-12-17</end><night_count>7</night_count><prices><price><final_price>12990</final_price></price></prices><purchase_url>https://p.test/b/1a</purchase_url></term></terms></term_group></term_groups></tour>
    <tour><tour_id>2</tour_id><tour_title>Okruh Itálií</tour_title><tour_desc>Poznávací okruh, delší popis varianty</tour_desc><tour_detail_url>https://p.test/t/2</tour_detail_url><tour_type>200</tour_type><locations><location><country_id>ITA</country_id></location></locations><term_groups><term_group><terms><term><start>2027-01-10</start><end>2027-01-17</end><night_count>7</night_count><prices><price><final_price>11990</final_price></price></prices><purchase_url>https://p.test/b/2a</purchase_url></term></terms></term_group></term_groups></tour>${extra}</tours>`;
  it('variants of one tour merge into one product with dated terms and the lowest price', async () => {
    const h = makeHarness(); addFeed(h, { id: 5, partner: 'radynacestu', adapter: 'xml-sdovolena_tours', type: 'products' });
    serve(h, 5, tours());
    expect((await tickAll(h)).at(-1)!.status).toBe('ok');
    const p = rows<Record<string, string | number>>(h, 'SELECT * FROM products');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ type: 'poznavaci', price: 11990, country: 'Itálie', slug: 'okruh-italii-italie', date_from: '2026-12-10', partner_slug: 'radynacestu' });
    const meta = JSON.parse(String(p[0]!.meta_json)); expect(meta.terms).toHaveLength(2); expect(meta.dates).toEqual(['2026-12-10', '2027-01-10']);
    // repeat: unchanged, no write
    h.raw.prepare('UPDATE feeds SET force_run = 1').run(); await tickAll(h);
    expect(one<Record<string, number>>(h, 'SELECT * FROM import_runs ORDER BY id DESC LIMIT 1')).toMatchObject({ items_new: 0, items_changed: 0, items_unchanged: 1 });
  });
  it('a product that disappears from a complete feed is deactivated; a rejected one keeps its row', async () => {
    const h = makeHarness(); addFeed(h, { id: 5, partner: 'radynacestu', adapter: 'xml-sdovolena_tours', type: 'products' });
    const tour = (i: number, price = 12990) => `<tour><tour_id>${i}</tour_id><tour_title>Okruh ${i}</tour_title><tour_detail_url>https://p.test/t/${i}</tour_detail_url><tour_type>200</tour_type><locations><location><country_id>ITA</country_id></location></locations><term_groups><term_group><terms><term><start>2026-12-10</start><end>2026-12-17</end><night_count>7</night_count><prices><price><final_price>${price}</final_price></price></prices><purchase_url>https://p.test/b/${i}</purchase_url></term></terms></term_group></term_groups></tour>`;
    serve(h, 5, `<tours>${[1, 2, 3, 4].map((i) => tour(i)).join('')}</tours>`);
    await tickAll(h);
    expect(rows(h, 'SELECT * FROM products WHERE active = 1')).toHaveLength(4);
    h.raw.prepare('UPDATE feeds SET force_run = 1').run();
    serve(h, 5, `<tours>${tour(1)}${tour(2)}${tour(3, 0)}</tours>`); // tour 4 gone, tour 3 now invalid (price 0)
    const r = (await tickAll(h)).at(-1)!;
    expect(r.status).toBe('ok');
    const active = Object.fromEntries(rows<{ external_id: string; active: number }>(h, 'SELECT external_id, active FROM products').map((x) => [x.external_id, x.active]));
    expect(active).toEqual({ 'okruh-1-italie': 1, 'okruh-2-italie': 1, 'okruh-3-italie': 1, 'okruh-4-italie': 0 });
  });
  it('categorisation rules', () => {
    expect(categorize(['Plavba lodí po Nilu'], 'zajezdy')).toBe('plavby'); expect(categorize(['víkend ve Vídni'], 'zajezdy')).toBe('eurovikendy');
    expect(categorize(['200'], 'zajezdy')).toBe('poznavaci'); expect(categorize(['něco'], 'zazitky')).toBe('zazitky'); expect(categorize(['něco'], 'neexistuje')).toBe('zajezdy');
  });
});

describe('Čedok slim feed through R2', () => {
  const cedok = `<tours><tour><accommodation><title>Hotel Sunrise</title><gps><lat>36.1</lat><lon>29.5</lon></gps><desc>Čedok popis hotelu</desc></accommodation><locations><location><country_id>TUR</country_id><area_title>Antalya</area_title><place_title>Alanya</place_title></location></locations><photos><photo><url>https://img.test/c.jpg</url></photo></photos><terms><term><id>c1</id><final_price>21990</final_price><price_orig>25990</price_orig><start>2026-12-20</start><end>2026-12-27</end><night_count>7</night_count><meal>Ultra all inclusive</meal><transport>letecky</transport><airport>Praha</airport><purchase_url>https://p.test/c1</purchase_url></term></terms></tour></tours>`;
  it('imports an uploaded snapshot; the same snapshot is a no-op; a new upload runs ahead of the night window', async () => {
    const h = makeHarness();
    addFeed(h, { id: 41, partner: 'cedok', adapter: 'cedok-slim', kind: 'r2' });
    const req = (body: string) => new Request('https://import.test/feeds/41/snapshot', { method: 'PUT', headers: { authorization: 'Bearer ' + 'x'.repeat(32), 'content-length': String(Buffer.byteLength(body)) }, body });
    const waits: Promise<unknown>[] = []; const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
    h.setNow(new Date('2026-10-26T12:00:00Z')); // outside the window: only the manual upload makes it run
    expect((await handle(req(cedok), h.env, ctx)).status).toBe(200);
    expect((await tickAll(h)).at(-1)!.status).toBe('ok');
    const o = one<Record<string, unknown>>(h, 'SELECT * FROM offers');
    expect(o).toMatchObject({ meal_type: 'all-inclusive', price_pp: 21990, price_original: 25990, partner_slug: 'cedok', airport: 'Praha' });
    expect(one<Record<string, unknown>>(h, 'SELECT * FROM hotels')).toMatchObject({ country: 'Turecko', city: 'Alanya', stars: 0 });
    // same bytes again -> same etag -> not modified
    await handle(req(cedok), h.env, ctx);
    expect((await tickAll(h)).at(-1)!.status).toBe('not_modified');
    expect(rows(h, 'SELECT * FROM offers WHERE active = 1')).toHaveLength(1);
  });
});

describe('admin API', () => {
  const ctx = { waitUntil: () => {} };
  it('rejects missing or wrong credentials and a weak secret', async () => {
    const h = makeHarness();
    for (const auth of ['', 'Bearer nope', 'Bearer ' + 'x'.repeat(31)]) expect((await handle(new Request('https://i.test/status', { headers: auth ? { authorization: auth } : {} }), h.env, ctx)).status).toBe(401);
    expect((await handle(new Request('https://i.test/status', { headers: { authorization: 'Bearer short' } }), { ...h.env, IMPORT_SHARED_SECRET: 'short' }, ctx)).status).toBe(401);
  });
  it('status, run, pause/resume with an audit trail', async () => {
    const h = makeHarness(); addFeed(h, { id: 34, partner: 'dovolena-cz', adapter: 'xml-dovolena_hotels' });
    const call = (m: string, p: string) => handle(new Request('https://i.test' + p, { method: m, headers: { authorization: 'Bearer ' + 'x'.repeat(32) } }), h.env, ctx);
    expect(((await (await call('GET', '/status')).json()) as { feeds: unknown[] }).feeds).toHaveLength(1);
    await call('POST', '/feeds/34/pause'); expect(one<{ paused: number }>(h, 'SELECT paused FROM feeds').paused).toBe(1);
    serve(h, 34, dovolenaXml(manyHotels(3)));
    await call('POST', '/feeds/34/run'); expect(await tickAll(h)).toHaveLength(0); // paused feeds never run
    await call('POST', '/feeds/34/resume'); expect((await tickAll(h)).at(-1)!.status).toBe('ok');
    expect(rows(h, 'SELECT action FROM admin_audit').map((x) => x.action)).toEqual(['feed.pause', 'feed.run', 'feed.resume']);
    expect((await call('POST', '/feeds/999/run')).status).toBe(404);
  });
  it('upload endpoint validates size', async () => {
    const h = makeHarness(); addFeed(h, { id: 41, partner: 'cedok', adapter: 'cedok-slim', kind: 'r2' });
    const r = await handle(new Request('https://i.test/feeds/41/snapshot', { method: 'PUT', headers: { authorization: 'Bearer ' + 'x'.repeat(32), 'content-length': '10' }, body: 'tiny' }), h.env, ctx);
    expect(r.status).toBe(400);
  });
});

describe('daily maintenance and scheduling', () => {
  it('expires departed offers, slides the last-minute window, snapshots prices once a day and computes drops', async () => {
    const h = makeHarness(); addFeed(h, { id: 34, partner: 'dovolena-cz', adapter: 'xml-dovolena_hotels' });
    const hs = manyHotels(4); hs[0]!.offers[0]!.from = '2026-10-28'; hs[0]!.offers[0]!.to = '2026-11-04';
    serve(h, 34, dovolenaXml(hs)); await tickAll(h);
    expect(one<{ is_last_minute: number }>(h, "SELECT is_last_minute FROM offers WHERE external_id = 'o1'").is_last_minute).toBe(1);
    await runDaily(h.deps); const again = await runDaily(h.deps);
    expect(again.snapshots).toBe(0); // idempotent within a day
    expect(rows(h, 'SELECT * FROM price_history')).toHaveLength(4);
    // 8 days later the first offer departed, the others became last minute-free, and a price drop appears
    h.raw.prepare('UPDATE price_history SET min_price = 20000 WHERE hotel_id = 2').run(); // the snapshot ~7 days back said 20 000
    h.setNow(new Date(NOW.getTime() + 8 * 86400_000));
    const r = await runDaily(h.deps);
    expect(r.expiredOffers).toBe(1);
    expect(one<{ price_drop_pct: number; prev_min_price: number }>(h, 'SELECT price_drop_pct, prev_min_price FROM hotels WHERE id = 2')).toMatchObject({ price_drop_pct: 20, prev_min_price: 20000 });
    expect(one<{ offers_active: number }>(h, 'SELECT offers_active FROM hotels WHERE id = 1').offers_active).toBe(0);
  });
  it('window parsing and next run times respect DST', () => {
    expect(parseWindow('0-7')).toEqual([0, 7]); expect(parseWindow('3-3')).toBeNull(); expect(parseWindow('')).toBeNull();
    expect(windowOpen(new Date('2026-07-10T02:00:00Z'), [0, 7])).toBe(true); expect(windowOpen(new Date('2026-07-10T12:00:00Z'), [0, 7])).toBe(false);
    expect(windowOpen(new Date('2026-07-10T21:30:00Z'), [23, 5])).toBe(true); // wraps midnight
    expect(nextRunAt(new Date('2026-07-10T10:00:00Z'), 24, [0, 7])).toBe('2026-07-10 22:00:00'); // CEST
    expect(nextRunAt(new Date('2026-12-10T10:00:00Z'), 12, [0, 7])).toBe('2026-12-10 23:00:00'); // CET, interval < 24 h still means once per day (same rule as the WP scheduler)
    expect(nextRunAt(new Date('2026-12-10T10:00:00Z'), 6, null)).toBe('2026-12-10 16:00:00');
  });
});

describe('real feed configuration from the WordPress export', () => {
  const exp = '/home/kenny/ai/backups/kakapo-wp-export-2026-10-26/feeds.ndjson';
  it('every exported feed maps to a registered adapter with a usable mapping', async () => {
    const { existsSync, readFileSync } = await import('node:fs');
    if (!existsSync(exp)) return; // export lives outside the repo; the check is skipped where it is not available
    const { ADAPTERS, feedMapping } = await import('../../workers/import/src/adapters');
    const CJ: Record<string, string> = { fischer: 'cj-atcom', 'exim-tours': 'cj-atcom', 'blue-style': 'cj-bluestyle', tui: 'cj-tui' };
    let checked = 0;
    for (const l of readFileSync(exp, 'utf8').split('\n').filter(Boolean)) {
      const f = JSON.parse(l);
      const adapter = f.source_type === 'cj' ? CJ[f.partner_slug] ?? 'cj-generic' : f.partner_slug === 'cedok' ? 'cedok-slim' : `xml-${f.format_preset}`;
      expect(ADAPTERS, `feed ${f.id}`).toContain(adapter);
      if (f.source_type !== 'cj') {
        const m = feedMapping({ id: f.id, adapter, mapping_json: f.mapping ?? '{}' } as never);
        expect(m.item, `feed ${f.id}`).toBeTruthy(); expect(Object.keys(m.fields).length, `feed ${f.id}`).toBeGreaterThan(3); checked++;
      } else expect(JSON.parse(f.mapping).ad_id ?? JSON.parse(f.mapping).partner_id, `feed ${f.id}`).toBeTruthy();
    }
    expect(checked).toBeGreaterThan(30);
  });
  it('the real Invia hotel mapping (flat feed, hashed ids, nights from days) imports a synthetic Invia document', async () => {
    const { existsSync, readFileSync } = await import('node:fs');
    if (!existsSync(exp)) return;
    const f13 = JSON.parse(readFileSync(exp, 'utf8').split('\n').find((l) => JSON.parse(l || '{"id":0}').id === '13')!);
    const h = makeHarness(); addFeed(h, { id: 13, partner: 'invia', adapter: 'xml-invia_hotels', mapping: JSON.parse(f13.mapping) });
    const offer = (i: number) => `<offer><hotel>Hotel Invia ${i}</hotel><destination><country>Egypt</country><locality>Hurghada</locality></destination><hotelinfo><stars>4</stars><coords><lat>27.2</lat><lng>33.8</lng></coords><description>&lt;p&gt;Popis&lt;/p&gt;</description></hotelinfo><photos><photo>https://i.test/${i}.jpg</photo></photos><url>https://www.invia.cz/o/${i}?aff=1</url><price>${15000 + i}</price><totalprice>${30000 + i}</totalprice><term><from>2026-12-0${(i % 8) + 1}</from><to>2026-12-1${i % 8}</to><length>8</length></term><food>All inclusive</food><transportation>letecky</transportation><airports><airport>Praha</airport></airports><image>https://i.test/${i}.jpg</image></offer>`;
    serve(h, 13, `<?xml version="1.0"?><offers>${Array.from({ length: 25 }, (_, i) => offer(i + 1)).join('')}</offers>`);
    const r = (await tickAll(h)).at(-1)!;
    expect(r.status).toBe('ok');
    const o = rows<Record<string, string | number>>(h, 'SELECT * FROM offers ORDER BY id')[0]!;
    expect(o).toMatchObject({ nights: 7, meal_type: 'all-inclusive', price_total: 30001 });
    expect(String(o.external_id)).toMatch(/^[0-9a-f]{24}$/); // md5(url) prefix, same as the WP importer
  });
});
