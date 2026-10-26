import { describe, expect, it } from 'vitest';
import { addFeed, dovolenaXml, makeHarness, manyHotels, one, rows, serve, tickAll, type Harness } from './helpers';
import { THEME_BITS } from '../../src/lib/themes';
import { afterRun, SITEMAP_MIN_AGE_MS } from '../../workers/import/src/engine/post';
import { runDaily } from '../../workers/import/src/engine/daily';

const flags = (h: Harness, name: string) => one<{ theme_flags: number }>(h, 'SELECT theme_flags FROM hotels WHERE name = ?', name).theme_flags;
const setup = () => { const h = makeHarness(); addFeed(h, { id: 34, partner: 'dovolena-cz', adapter: 'xml-dovolena_hotels' }); return h; };
const reimport = async (h: Harness, xml: string) => { serve(h, 34, xml); h.raw.prepare('UPDATE feeds SET force_run = 1').run(); return (await tickAll(h)).at(-1)!; };

describe('theme_flags', () => {
  it('are computed from name, description and amenities at import', async () => {
    const h = setup();
    const hs = manyHotels(4);
    hs[0]!.desc = 'Hotel s aquaparkem a dětským klubem přímo u pláže.';
    hs[1]!.desc = 'Široká pláž s jemným pískem a pozvolným vstupem do moře. '.repeat(2);
    hs[2]!.desc = 'Klidný hotel pro dospělé, bez zvláštností. '.repeat(3);
    hs[3]!.name = 'Family Resort Test'; hs[3]!.desc = 'Obyčejný popis hotelu, který neobsahuje žádné klíčové slovo.';
    serve(h, 34, dovolenaXml(hs)); await tickAll(h);
    expect(flags(h, 'Hotel Test 1')).toBe(THEME_BITS.children! | THEME_BITS.aquapark!);
    expect(flags(h, 'Hotel Test 2')).toBe(THEME_BITS['sandy-beach']!);
    expect(flags(h, 'Hotel Test 3')).toBe(0);
    expect(flags(h, 'Family Resort Test')).toBe(THEME_BITS.children!); // name counts for children, not for sandy-beach
  });

  it('use active offer titles and rooms (max 40) and follow offer changes', async () => {
    const h = setup();
    serve(h, 34, dovolenaXml(manyHotels(2))); await tickAll(h);
    expect(flags(h, 'Hotel Test 1')).toBe(0);
    h.raw.prepare("UPDATE offers SET title = 'Rodinný pokoj family room' WHERE external_id = 'o1'").run();
    h.raw.prepare('UPDATE hotels SET offers_last_seen = NULL').run();
    const { recomputeAggregates } = await import('../../workers/import/src/engine/hotels');
    await recomputeAggregates(h.db, [1], { today: '2026-10-26', nowSql: '2026-10-26 02:00:00' });
    expect(flags(h, 'Hotel Test 1')).toBe(THEME_BITS.children!);
    // 100 offers: only the first 40 texts are looked at, a keyword in the 41st offer is ignored
    h.raw.prepare('UPDATE offers SET title = ? WHERE external_id = ?').run('x', 'o1');
    const ins = h.raw.prepare("INSERT INTO offers (hotel_id,feed_id,partner_slug,external_id,content_hash,title,price_pp,departure_date,affiliate_url,last_seen,created_at,updated_at) VALUES (1,34,'dovolena-cz',?,'h',?,9999,'2027-01-01','https://p.test/x','2026-10-26','2026-10-26','2026-10-26')");
    for (let i = 0; i < 45; i++) ins.run(`extra${i}`, i === 42 ? 'aquapark room' : `plain ${i}`);
    await recomputeAggregates(h.db, [1], { today: '2026-10-26', nowSql: '2026-10-26 03:00:00' });
    expect(flags(h, 'Hotel Test 1') & THEME_BITS.aquapark!).toBe(0);
  });

  it('a changed feed description updates the flags in the same run; unchanged hotels are not written again', async () => {
    const h = setup();
    serve(h, 34, dovolenaXml(manyHotels(3))); await tickAll(h);
    const hs = manyHotels(3); hs[1]!.desc = 'Hotel má vlastní vodní park a skluzavky pro všechny děti. '.repeat(3);
    // new description is only taken when it is richer: make the stored one empty like a thin feed text
    h.raw.prepare("UPDATE hotels SET description = '' WHERE name = 'Hotel Test 2'").run();
    await reimport(h, dovolenaXml(hs));
    expect(flags(h, 'Hotel Test 2')).toBe(THEME_BITS.children! | THEME_BITS.aquapark!);
    const hotelUpdates = () => h.sqlLog.filter((s) => s.startsWith('UPDATE hotels SET min_price')).length;
    const before = hotelUpdates();
    await reimport(h, dovolenaXml(hs));
    // aggregates are recomputed for the feed's hotels, but nothing changed => zero hotel UPDATE statements prepared
    expect(hotelUpdates()).toBe(before);
  });
});

describe('after a successful run: snapshots and sitemaps', () => {
  it('snapshots are rebuilt after every successful run and fill site_cache (real src/lib/snapshots.ts)', async () => {
    const h = setup();
    serve(h, 34, dovolenaXml(manyHotels(6))); await tickAll(h);
    const keys = rows<{ key: string }>(h, "SELECT key FROM site_cache WHERE key IN ('registry','facets','data_version')").map((r) => r.key).sort();
    expect(keys).toEqual(['data_version', 'facets', 'registry']);
    const reg = JSON.parse(one<{ value: string }>(h, "SELECT value FROM site_cache WHERE key = 'registry'").value);
    expect(reg.countries.recko.cnt).toBe(6);
    expect(Object.keys(reg.partners)).toEqual(['dovolena-cz']);
  });

  it('sitemaps are rebuilt at most once per 20 hours, with SITE_URL from the vars', async () => {
    const h = makeHarness({ SITE_URL: 'https://example.test/' });
    addFeed(h, { id: 34, partner: 'dovolena-cz', adapter: 'xml-dovolena_hotels' });
    const calls: Array<{ kind: string; arg?: string }> = [];
    h.deps.hooks = {
      rebuildSnapshots: async () => { calls.push({ kind: 'snap' }); },
      rebuildSitemaps: async (db, base) => { calls.push({ kind: 'sitemap', arg: base }); db.prepare("INSERT INTO site_cache (key,value,updated_at) VALUES ('sitemap:index','x',?) ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at").bind(h.deps.now().toISOString()).run(); },
    };
    serve(h, 34, dovolenaXml(manyHotels(3))); await tickAll(h);
    expect(calls).toEqual([{ kind: 'snap' }, { kind: 'sitemap', arg: 'https://example.test' }]);
    await reimport(h, dovolenaXml(manyHotels(3)));        // identical 2nd run: nothing written → no rebuild, edge cache stays warm
    expect(calls.map((c) => c.kind)).toEqual(['snap', 'sitemap']);
    h.setNow(new Date(h.deps.now().getTime() + SITEMAP_MIN_AGE_MS - 60_000));
    await afterRun(h.deps); expect(calls.filter((c) => c.kind === 'sitemap')).toHaveLength(1); // 19 h 59 min: still fresh
    h.setNow(new Date(h.deps.now().getTime() + 120_000));
    await afterRun(h.deps); expect(calls.filter((c) => c.kind === 'sitemap')).toHaveLength(2); // > 20 h
  });

  it('a failing snapshot/sitemap step is logged but does not fail the import', async () => {
    const h = setup();
    h.deps.hooks = { rebuildSnapshots: async () => { throw new Error('boom'); }, rebuildSitemaps: async () => { throw new Error('boom2'); } };
    serve(h, 34, dovolenaXml(manyHotels(3)));
    expect((await tickAll(h)).at(-1)!.status).toBe('ok');
    expect(h.logs.join()).toContain('post.snapshots_failed'); expect(h.logs.join()).toContain('post.sitemaps_failed');
  });

  it('a failed or not-modified run does not trigger the rebuild', async () => {
    const h = setup(); let n = 0;
    h.deps.hooks = { rebuildSnapshots: async () => { n++; }, rebuildSitemaps: async () => { n++; } };
    serve(h, 34, ''); await tickAll(h);
    expect(n).toBe(0);
  });

  it('daily maintenance also refreshes snapshots', async () => {
    const h = setup(); let n = 0;
    h.deps.hooks = { rebuildSnapshots: async () => { n++; }, rebuildSitemaps: async () => {} };
    await runDaily(h.deps); expect(n).toBe(1);
  });
});
