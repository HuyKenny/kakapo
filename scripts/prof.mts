import { DatabaseSync } from 'node:sqlite';
import { wrap } from '../tests/landing/d1.ts';
import { dispatch } from '../src/lib/dispatch.ts';
import { loadListing } from '../src/lib/listing/index.ts';
const raw = new DatabaseSync('/home/kenny/ai/apps/kakapo/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/9ba2b04bf514d9facfd57ed57d849e77241a7adc99d1c1545d06688b43d84248.sqlite');
const log: Array<{ ms: number; sql: string }> = [];
const inner: any = wrap(raw);
const db: any = { prepare(sql: string) { const s = inner.prepare(sql); const mk = (st: any): any => ({ bind: (...a: any[]) => mk(st.bind(...a)), async all() { const t = performance.now(); const r = await st.all(); log.push({ ms: performance.now() - t, sql }); return r; }, async first() { const t = performance.now(); const r = await st.first(); log.push({ ms: performance.now() - t, sql }); return r; }, async run() { const t = performance.now(); const r = await st.run(); log.push({ ms: performance.now() - t, sql }); return r; } }); return mk(s); }, batch: inner.batch };
for (const path of process.argv.slice(2)) {
  log.length = 0; const t0 = performance.now();
  const d: any = await dispatch(db, path);
  if (d.kind === 'listing') await loadListing(db, d.ctx, new URLSearchParams(), d.deps);
  const tot = performance.now() - t0;
  console.log(`${path} kind=${d.kind} total=${tot.toFixed(0)}ms queries=${log.length} sqlTime=${log.reduce((a, b) => a + b.ms, 0).toFixed(0)}ms`);
  for (const q of [...log].sort((a, b) => b.ms - a.ms).slice(0, 4)) console.log('  ', q.ms.toFixed(0) + 'ms', q.sql.replace(/\s+/g, ' ').slice(0, 130));
}
