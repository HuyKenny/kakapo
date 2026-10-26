import { beforeEach, describe, expect, it } from 'vitest';
import { addFeed, dovolenaXml, makeHarness, manyHotels, one, rows, serve, tickAll, FEED_HOST, SECRET_TOKEN, type Harness } from './helpers';
import { runTick } from '../../workers/import/src/engine/tick';
import { approveRun, stepFeed } from '../../workers/import/src/engine/run';

let h: Harness;
const FEED = 34;
const run = async () => (await tickAll(h)).at(-1)!;
const offers = (where = '1=1') => rows<{ id: number; external_id: string; price_pp: number; active: number; prev_price_pp: number | null; seen_run: number; updated_at: string; hotel_id: number }>(h, `SELECT * FROM offers WHERE ${where} ORDER BY id`);
const lastRun = () => one<Record<string, number | string>>(h, 'SELECT * FROM import_runs ORDER BY id DESC LIMIT 1');

beforeEach(() => { h = makeHarness(); addFeed(h, { id: FEED, partner: 'dovolena-cz', adapter: 'xml-dovolena_hotels' }); });

describe('first import and repeat', () => {
  it('imports hotels and offers, computes aggregates and reports counters', async () => {
    serve(h, FEED, dovolenaXml(manyHotels(30)));
    const r = await run();
    expect(r.status).toBe('ok');
    expect(offers()).toHaveLength(30);
    expect(rows(h, 'SELECT * FROM hotels')).toHaveLength(30);
    const hotel = one<Record<string, unknown>>(h, "SELECT * FROM hotels WHERE name = 'Hotel Test 1'");
    expect(hotel).toMatchObject({ min_price: 15990, offers_active: 1, partners_count: 1, has_all_inclusive: 1, meal_flags: 1, airports_csv: 'praha', country_slug: 'recko', stars: 4 });
    expect(hotel.slug).toBe('hotel-test-1-place-1');
    expect(lastRun()).toMatchObject({ status: 'ok', items_read: 30, items_new: 30, items_changed: 0, items_unchanged: 0, items_rejected: 0, items_deactivated: 0 });
    expect(one<{ last_success_count: number }>(h, 'SELECT * FROM feeds WHERE id = ?', FEED).last_success_count).toBe(30);
    expect(one<{ n: number }>(h, 'SELECT COUNT(*) n FROM import_runs').n).toBe(1);
    expect(h.r2.store.size).toBeGreaterThan(1); // blocks + manifest kept for the last good run
  });

  it('repeating the same feed changes nothing and writes no offer rows', async () => {
    serve(h, FEED, dovolenaXml(manyHotels(30)));
    await run();
    const before = offers(); const hotelsBefore = rows(h, 'SELECT * FROM hotels');
    h.setNow(new Date(h.deps.now().getTime() + 24 * 3600_000));
    h.raw.prepare('UPDATE feeds SET force_run = 1').run();
    const offerWrites = () => h.sqlLog.filter((s) => /^(INSERT INTO offers|UPDATE offers|DELETE FROM offers)/.test(s)).length;
    const writesBefore = offerWrites();
    await run();
    expect(lastRun()).toMatchObject({ status: 'ok', items_new: 0, items_changed: 0, items_unchanged: 30, items_deactivated: 0 });
    expect(offers()).toEqual(before); // identical rows incl. updated_at / seen_run: unchanged offers are not touched
    expect(rows(h, 'SELECT * FROM hotels').map((x) => x.id)).toEqual(hotelsBefore.map((x) => x.id));
    expect(offerWrites()).toBe(writesBefore); // not a single INSERT/UPDATE/DELETE statement was even prepared
  });

  it('a price change updates one offer, keeps the previous price and refreshes the hotel minimum', async () => {
    serve(h, FEED, dovolenaXml(manyHotels(30)));
    await run();
    const hs = manyHotels(30); hs[4]!.offers[0]!.price = 12990;
    serve(h, FEED, dovolenaXml(hs));
    h.raw.prepare('UPDATE feeds SET force_run = 1').run();
    await run();
    expect(lastRun()).toMatchObject({ items_changed: 1, items_new: 0, items_unchanged: 29 });
    const o = offers("external_id = 'o5'")[0]!;
    expect(o).toMatchObject({ price_pp: 12990, prev_price_pp: 15990 });
    expect(one<{ min_price: number }>(h, 'SELECT min_price FROM hotels WHERE id = ?', o.hotel_id).min_price).toBe(12990);
  });

  it('a new offer is added and a vanished one is deactivated (complete feed)', async () => {
    serve(h, FEED, dovolenaXml(manyHotels(30)));
    await run();
    const hs = manyHotels(30).filter((x) => x.id !== 'h3'); hs.push(...manyHotels(1, 9990, 31));
    serve(h, FEED, dovolenaXml(hs));
    h.raw.prepare('UPDATE feeds SET force_run = 1').run();
    await run();
    expect(lastRun()).toMatchObject({ status: 'ok', items_new: 1, items_deactivated: 1 });
    expect(offers("external_id = 'o3'")[0]!.active).toBe(0);
    expect(offers("external_id = 'o31'")[0]!.active).toBe(1);
    const gone = one<Record<string, number | null>>(h, "SELECT * FROM hotels WHERE name = 'Hotel Test 3'");
    expect(gone).toMatchObject({ offers_active: 0, min_price: null }); // hotel row (and URL) stays
  });
});

describe('broken, empty and unavailable feeds never touch the catalogue', () => {
  beforeEach(async () => { serve(h, FEED, dovolenaXml(manyHotels(30))); await run(); h.raw.prepare('UPDATE feeds SET force_run = 1').run(); });
  const unchanged = () => expect(offers().filter((o) => o.active === 1)).toHaveLength(30);

  it('empty body', async () => { serve(h, FEED, ''); const r = await run(); expect(r.status).toBe('failed'); unchanged(); expect(lastRun().status).toBe('failed'); });
  it('valid XML without items', async () => { serve(h, FEED, '<?xml version="1.0"?><hotels></hotels>'); const r = await run(); expect(r.status).toBe('failed'); expect(r.message).toMatch(/no valid items/); unchanged(); });
  it('truncated XML', async () => { const x = dovolenaXml(manyHotels(30)); serve(h, FEED, x.slice(0, x.length - 400)); const r = await run(); expect(r.status).toBe('failed'); expect(r.message).toMatch(/truncated/); unchanged(); expect(one<{ n: number }>(h, 'SELECT COUNT(*) n FROM import_runs WHERE status = ?', 'failed').n).toBe(1); });
  it('malformed XML', async () => { serve(h, FEED, '<hotels><hotel id="1"><name>x</hotel></hotels>'); const r = await run(); expect(r.status).toBe('failed'); unchanged(); });
  it('wrong encoding', async () => { serve(h, FEED, Buffer.concat([Buffer.from('<?xml version="1.0" encoding="UTF-8"?><hotels><hotel id="1"><name>'), Buffer.from([0xff, 0xfe]), Buffer.from('</name></hotel></hotels>')])); const r = await run(); expect(r.status).toBe('failed'); expect(r.message).toMatch(/encoding/); unchanged(); });
  it('HTML error page served with 200', async () => { serve(h, FEED, '<html><body>Service temporarily unavailable</body></html>'); const r = await run(); expect(r.status).toBe('failed'); unchanged(); });
  it('partner unavailable: bounded retries with exponential backoff, then failure', async () => {
    h.routes.set(`${FEED_HOST}/f${FEED}.xml`, () => new Response('down', { status: 503 }));
    const r = await run();
    expect(r.status).toBe('failed');
    expect(h.fetchLog.filter((x) => x.endsWith(`/f${FEED}.xml`))).toHaveLength(1 + 3); // 1 initial import + 3 attempts now
    expect(h.sleeps.slice(-2)).toEqual([1000, 2000]);
    unchanged();
    expect(one<{ current_run: number | null }>(h, 'SELECT current_run FROM feeds WHERE id = ?', FEED).current_run).toBeNull();
  });
  it('a failed run schedules a retry and does not mark the feed as successfully imported', async () => {
    const before = one<{ last_success_run: number }>(h, 'SELECT last_success_run FROM feeds WHERE id = ?', FEED).last_success_run;
    serve(h, FEED, ''); await run();
    const f = one<{ last_success_run: number; next_run_at: string }>(h, 'SELECT * FROM feeds WHERE id = ?', FEED);
    expect(f.last_success_run).toBe(before);
    expect(f.next_run_at > '2026-10-26 02:00:00').toBe(true);
  });
  it('mostly invalid records are treated as a broken mapping, not as a catalogue to import', async () => {
    serve(h, FEED, dovolenaXml(manyHotels(30, 0))); // price 0 everywhere
    const r = await run(); expect(r.status).toBe('failed'); unchanged();
  });
});

describe('conditional requests', () => {
  it('304 is a successful no-op, never an empty catalogue', async () => {
    h.routes.set(`${FEED_HOST}/f${FEED}.xml`, () => new Response(dovolenaXml(manyHotels(30)), { headers: { etag: '"v1"' } }));
    await run();
    expect(one<{ etag: string }>(h, 'SELECT etag FROM feeds WHERE id = ?', FEED).etag).toBe('"v1"');
    let seen = '';
    h.routes.set(`${FEED_HOST}/f${FEED}.xml`, (_u, init) => { seen = new Headers(init?.headers).get('if-none-match') ?? ''; return new Response(null, { status: 304 }); });
    h.raw.prepare('UPDATE feeds SET force_run = 1').run();
    const r = await run();
    expect(seen).toBe('"v1"');
    expect(r.status).toBe('not_modified');
    expect(offers().filter((o) => o.active === 1)).toHaveLength(30);
    expect(lastRun().message).toMatch(/not modified/);
  });
});

describe('suspicious drops and incremental feeds', () => {
  beforeEach(async () => { serve(h, FEED, dovolenaXml(manyHotels(100))); await run(); h.raw.prepare('UPDATE feeds SET force_run = 1').run(); });

  it('a feed that suddenly shrinks by more than the limit is parked, not applied; approval applies it', async () => {
    serve(h, FEED, dovolenaXml(manyHotels(40)));
    const r = await run();
    expect(r.status).toBe('suspicious');
    expect(offers().filter((o) => o.active === 1)).toHaveLength(100);
    expect(lastRun().status).toBe('suspicious');
    const a = await approveRun(h.deps, FEED, Date.now() + 60_000);
    expect(a.status).toBe('ok');
    expect(offers().filter((o) => o.active === 1)).toHaveLength(40);
  });

  it('many ids vanishing while the size looks normal is also held (ratio guard), then approved', async () => {
    serve(h, FEED, dovolenaXml(manyHotels(100, 15990, 61))); // 60 old ids replaced by 60 new, size stays 100
    const r = await run();
    expect(r.status).toBe('suspicious');
    expect(r.message).toMatch(/missing from the feed/);
    expect(offers().filter((o) => o.active === 1).length).toBe(160); // new ones applied, nothing deactivated
    expect((await approveRun(h.deps, FEED, Date.now() + 60_000)).status).toBe('ok');
    expect(offers().filter((o) => o.active === 1)).toHaveLength(100);
  });

  it('an incremental feed never deactivates what it does not list', async () => {
    h.raw.prepare('UPDATE feeds SET is_full_catalogue = 0').run();
    serve(h, FEED, dovolenaXml(manyHotels(5)));
    const r = await run();
    expect(r.status).toBe('ok');
    expect(offers().filter((o) => o.active === 1)).toHaveLength(100);
  });

  it('a record that fails validation keeps its previous offer alive (parse error != removal)', async () => {
    const hs = manyHotels(100); hs[9]!.offers[0]!.price = 'abc'; // price becomes 0 -> rejected
    serve(h, FEED, dovolenaXml(hs));
    const r = await run();
    expect(r.status).toBe('ok');
    expect(offers("external_id = 'o10'")[0]!.active).toBe(1);
    expect(lastRun()).toMatchObject({ items_rejected: 1, items_deactivated: 0 });
    expect(one<{ reason: string }>(h, 'SELECT reason FROM import_errors').reason).toMatch(/price/);
  });

  it('past departures are skipped and their offers expire', async () => {
    const hs = manyHotels(100); hs[0]!.offers[0]!.from = '2026-10-01'; hs[0]!.offers[0]!.to = '2026-10-08';
    serve(h, FEED, dovolenaXml(hs));
    await run();
    expect(offers("external_id = 'o1'")[0]!.active).toBe(0);
  });
});

describe('interruption, resume and duplicate delivery', () => {
  it('a run interrupted between blocks resumes from its checkpoint and ends identical to an uninterrupted one', async () => {
    serve(h, FEED, dovolenaXml(manyHotels(700))); // 4 blocks of 200
    let r = await stepFeed({ ...h.deps }, FEED, Date.now() - 1); // deadline already passed: stops after the first block
    expect(r.status).toBe('continue');
    expect(offers().length).toBe(200);
    expect(one<{ current_run: number }>(h, 'SELECT current_run FROM feeds WHERE id = ?', FEED).current_run).toBeTruthy();
    r = await stepFeed(h.deps, FEED, Date.now() - 1); expect(r.status).toBe('continue'); expect(offers().length).toBe(400);
    r = await stepFeed(h.deps, FEED, Date.now() + 60_000);
    expect(r.status).toBe('ok');
    expect(offers().length).toBe(700);
    expect(one<{ n: number }>(h, 'SELECT COUNT(*) n FROM import_runs').n).toBe(1); // one run, resumed, not restarted
    expect(lastRun()).toMatchObject({ status: 'ok', items_new: 700 });
  });

  it('re-applying an already applied block (duplicate delivery) is idempotent', async () => {
    serve(h, FEED, dovolenaXml(manyHotels(50)));
    await run();
    const snapshot = JSON.stringify(offers()) + JSON.stringify(rows(h, 'SELECT * FROM hotels'));
    const f = one<{ last_success_run: number }>(h, 'SELECT last_success_run FROM feeds WHERE id = ?', FEED);
    // simulate the same run being delivered again: reopen it at block 0
    const cp = JSON.parse(one<{ checkpoint_json: string }>(h, 'SELECT checkpoint_json FROM import_runs WHERE id = ?', f.last_success_run).checkpoint_json);
    cp.phase = 'apply'; cp.next = 0; cp.counters = { read: 0, accepted: 50, rejected: 0, created: 0, changed: 0, unchanged: 0, stale: 0, hotelsCreated: 0, rows: 0, deactivated: 0 };
    h.raw.prepare("UPDATE import_runs SET status = 'running', checkpoint_json = ? WHERE id = ?").run(JSON.stringify(cp), f.last_success_run);
    h.raw.prepare('UPDATE feeds SET current_run = ? WHERE id = ?').run(f.last_success_run, FEED);
    const r = await stepFeed(h.deps, FEED, Date.now() + 60_000);
    expect(r.status).toBe('ok');
    expect(JSON.stringify(offers()) + JSON.stringify(rows(h, 'SELECT * FROM hotels'))).toBe(snapshot);
  });

  it('an older run cannot overwrite data written by a newer run', async () => {
    serve(h, FEED, dovolenaXml(manyHotels(5)));
    await run();
    h.raw.prepare('UPDATE offers SET seen_run = 9999, price_pp = 1000 WHERE external_id = ?').run('o1'); // as if a newer run had priced it at 1000
    const hs = manyHotels(5); hs[0]!.offers[0]!.price = 20000;
    serve(h, FEED, dovolenaXml(hs));
    h.raw.prepare('UPDATE feeds SET force_run = 1').run();
    await run();
    expect(offers("external_id = 'o1'")[0]!.price_pp).toBe(1000);
  });

  it('two concurrent importers of the same feed: the second one is refused by the lock', async () => {
    h.raw.prepare('UPDATE feeds SET lock_until = ? WHERE id = ?').run('2026-10-26 02:10:00', FEED);
    serve(h, FEED, dovolenaXml(manyHotels(5)));
    const r = await stepFeed(h.deps, FEED, Date.now() + 1000);
    expect(r.status).toBe('locked');
    expect(offers()).toHaveLength(0);
    expect(h.fetchLog).toHaveLength(0);
  });

  it('a run that lost ownership (feed.current_run changed) stops without writing', async () => {
    serve(h, FEED, dovolenaXml(manyHotels(500)));
    const realGet = h.r2.get.bind(h.r2);
    h.r2.get = async (key) => { if (key.endsWith('block-00000.ndjson')) h.raw.prepare('UPDATE feeds SET current_run = 99999 WHERE id = ?').run(FEED); return realGet(key); };
    const r = await stepFeed(h.deps, FEED, Date.now() + 60_000);
    expect(r.status).toBe('superseded');
    expect(offers().length).toBe(200); // only the block that was already in flight; nothing after ownership was lost
  });
});

describe('catalogue rules', () => {
  it('the same hotel from two partners becomes one hotel with two offers; richer data is not overwritten', async () => {
    addFeed(h, { id: 13, partner: 'invia', adapter: 'xml-dovolena_hotels', mapping: JSON.parse('{}') });
    serve(h, FEED, dovolenaXml([{ id: 'a', name: 'Hotel Aurora', locality: 'Hersonissos', desc: 'x'.repeat(40), offers: [{ id: 'a1', price: 20000 }] }]));
    serve(h, 13, dovolenaXml([{ id: 'b', name: 'Aurora Hotel', locality: 'Hersonissos', desc: 'Long official description of Aurora hotel from a better source. '.repeat(3), offers: [{ id: 'b1', price: 18000 }] }]));
    await run();
    expect(rows(h, 'SELECT * FROM hotels')).toHaveLength(1);
    const hotel = one<Record<string, unknown>>(h, 'SELECT * FROM hotels');
    expect(hotel).toMatchObject({ offers_active: 2, min_price: 18000, partners_count: 2 });
    expect(offers().map((o) => o.price_pp).sort()).toEqual([18000, 20000]);
  });

  it('an editorial description (description_source = kakapo) is never replaced by a feed text', async () => {
    serve(h, FEED, dovolenaXml(manyHotels(3)));
    await run();
    h.raw.prepare("UPDATE hotels SET description = 'Náš vlastní text', description_source = 'kakapo' WHERE name = 'Hotel Test 1'").run();
    serve(h, FEED, dovolenaXml(manyHotels(3).map((x) => ({ ...x, desc: 'A very long replacement description from the feed. '.repeat(10) }))));
    h.raw.prepare('UPDATE feeds SET force_run = 1').run();
    await run();
    expect(one<{ description: string }>(h, "SELECT description FROM hotels WHERE name = 'Hotel Test 1'").description).toBe('Náš vlastní text');
  });

  it('manual alias keeps pointing a feed name to the merged hotel (no duplicate is created)', async () => {
    serve(h, FEED, dovolenaXml(manyHotels(2)));
    await run();
    const target = one<{ id: number }>(h, "SELECT id FROM hotels WHERE name = 'Hotel Test 1'").id;
    h.raw.prepare("INSERT INTO hotel_aliases (alias_key, hotel_id, created_at) VALUES ('recko|moje-misto|zcela-jiny-nazev', ?, 'x')").run(target);
    serve(h, FEED, dovolenaXml([...manyHotels(2), { id: 'z', name: 'Zcela jiny nazev', locality: 'Moje misto', offers: [{ id: 'zz', price: 9000 }] }]));
    h.raw.prepare('UPDATE feeds SET force_run = 1').run();
    await run();
    expect(rows(h, 'SELECT * FROM hotels')).toHaveLength(2);
    expect(offers("external_id = 'zz'")[0]!.hotel_id).toBe(target);
  });

  it('the same partner offer arriving through another feed replaces the old row (no duplicate offers)', async () => {
    addFeed(h, { id: 35, partner: 'dovolena-cz', adapter: 'xml-dovolena_hotels' });
    serve(h, FEED, dovolenaXml(manyHotels(3)));
    serve(h, 35, dovolenaXml(manyHotels(1)));
    await run();
    h.raw.prepare('UPDATE feeds SET force_run = 1 WHERE id = ?').run(FEED);
    await run();
    const o1 = offers("external_id = 'o1'");
    expect(o1).toHaveLength(1);
  });

  it('feed URLs and tokens never appear in logs, run messages or errors', async () => {
    h.routes.set(`${FEED_HOST}/f${FEED}.xml`, () => new Response('down', { status: 500 }));
    await run();
    const all = JSON.stringify([h.logs, rows(h, 'SELECT message FROM import_runs'), rows(h, 'SELECT reason FROM import_errors')]);
    expect(all).not.toContain(SECRET_TOKEN);
    expect(all).not.toContain(FEED_HOST);
  });

  it('the import window and manual runs are respected by the tick', async () => {
    serve(h, FEED, dovolenaXml(manyHotels(3)));
    h.setNow(new Date('2026-10-26T12:00:00Z')); // 14:00 Prague: closed
    expect(await runTick(h.deps)).toHaveLength(0);
    h.raw.prepare('UPDATE feeds SET force_run = 1').run(); // manual run ignores the window
    expect((await runTick(h.deps))[0]!.status).toBe('ok');
    const next = one<{ next_run_at: string }>(h, 'SELECT next_run_at FROM feeds WHERE id = ?', FEED).next_run_at;
    expect(next).toBe('2026-10-26 23:00:00'); // next day 00:00 Prague (CET after the 25 Oct DST change = UTC 23:00), window start
  });
});
