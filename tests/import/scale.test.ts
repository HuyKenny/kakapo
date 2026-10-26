// Catalogue-sized run (≈ the real 22 700 active offers) to measure statements, rows written and time of the engine.
// Numbers are printed as one JSON line starting with "SCALE" and copied into docs/TEST-REPORT-import.md.
import { describe, expect, it } from 'vitest';
import { addFeed, dovolenaXml, makeHarness, manyHotels, one, rows, serve, tickAll } from './helpers';

describe('catalogue scale', () => {
  it('22 700 offers: first import, identical repeat, and a 5 % price-change run', async () => {
    const h = makeHarness();
    addFeed(h, { id: 34, partner: 'dovolena-cz', adapter: 'xml-dovolena_hotels' });
    const N = 22_700;
    const hotels = manyHotels(N);
    const metrics: Record<string, unknown> = { offers: N };

    const t1 = Date.now(); const before1 = h.sqlLog.length;
    serve(h, 34, dovolenaXml(hotels));
    expect((await tickAll(h)).at(-1)!.status).toBe('ok');
    const r1 = one<Record<string, number>>(h, 'SELECT * FROM import_runs ORDER BY id DESC LIMIT 1');
    metrics.first = { ms: Date.now() - t1, prepared_statements: h.sqlLog.length - before1, rows_written: r1.rows_written, new: r1.items_new, duration_ms_in_run: r1.duration_ms };
    expect(rows(h, 'SELECT id FROM offers')).toHaveLength(N);

    h.raw.prepare('UPDATE feeds SET force_run = 1').run();
    const t2 = Date.now(); const before2 = h.sqlLog.length;
    serve(h, 34, dovolenaXml(hotels));
    await tickAll(h);
    const r2 = one<Record<string, number>>(h, 'SELECT * FROM import_runs ORDER BY id DESC LIMIT 1');
    metrics.repeat = { ms: Date.now() - t2, prepared_statements: h.sqlLog.length - before2, rows_written: r2.rows_written, unchanged: r2.items_unchanged, changed: r2.items_changed };
    expect(r2.rows_written).toBe(0); expect(r2.items_unchanged).toBe(N);

    const changed = manyHotels(N); for (let i = 0; i < N; i += 20) changed[i]!.offers[0]!.price = 14990;
    h.raw.prepare('UPDATE feeds SET force_run = 1').run();
    const t3 = Date.now(); const before3 = h.sqlLog.length;
    serve(h, 34, dovolenaXml(changed));
    await tickAll(h);
    const r3 = one<Record<string, number>>(h, 'SELECT * FROM import_runs ORDER BY id DESC LIMIT 1');
    metrics.changes5pct = { ms: Date.now() - t3, prepared_statements: h.sqlLog.length - before3, rows_written: r3.rows_written, changed: r3.items_changed, unchanged: r3.items_unchanged };
    expect(r3.items_changed).toBe(Math.ceil(N / 20));
    metrics.db_pages_mb = Number((Number(one<{ s: number }>(h, 'SELECT page_count * page_size AS s FROM pragma_page_count(), pragma_page_size()').s) / 1e6).toFixed(1));
    console.log('SCALE ' + JSON.stringify(metrics));
  }, 600_000);
});
