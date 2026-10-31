// Read-through cache for the public catalogue SELECTs (hotels/offers/products), kept in the colo's Cache API.
// Key = data_version + sql + params, so an import (which bumps data_version) or an admin write invalidates everything at once.
// Why: every listing page ran dozens of COUNT(*) scans over ~20k hotels (≈500 M D1 rows read per day, mostly bot-crawled long tail);
// the same counts repeat across pages and between imports (now once a day), so most queries become free Cache API hits.
import { dataVersion } from './versions';

const TTL_SEC = 6 * 3600;
const MAX_BYTES = 1_000_000;
const CACHEABLE = /^\s*SELECT\b[\s\S]*\bFROM\s+(hotels|offers|products)\b/i;
const EXCLUDE = /\b(site_cache|redirects|clicks|import_runs|import_errors|feeds)\b/i;
const isCacheable = (sql: string) => CACHEABLE.test(sql) && !EXCLUDE.test(sql);

type Wrapped = { sql: string; params: unknown[]; inner: D1PreparedStatement };
const meta = new WeakMap<object, Wrapped>();

async function keyFor(version: string, kind: string, sql: string, params: unknown[]): Promise<Request> {
  const data = new TextEncoder().encode(JSON.stringify([kind, sql, params]));
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return new Request(`https://kakapo.internal/__dbq/${encodeURIComponent(version)}/${hash}`);
}

export function cachedDb(db: D1Database): D1Database {
  const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  if (!c) return db;

  async function read<T>(req: Request): Promise<T | undefined> {
    try { const hit = await c!.match(req); return hit ? ((await hit.json()) as T) : undefined; } catch { return undefined; }
  }
  async function write(req: Request, value: unknown): Promise<void> {
    try {
      const body = JSON.stringify(value);
      if (body.length > MAX_BYTES) return;
      await c!.put(req, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${TTL_SEC}` } }));
    } catch { /* never fail a page over the cache */ }
  }
  async function version(): Promise<string | null> { try { return await dataVersion(); } catch { return null; } }

  function wrap(inner: D1PreparedStatement, sql: string, params: unknown[]): D1PreparedStatement {
    const px: D1PreparedStatement = new Proxy(inner, {
      get(t, k, r) {
        const v = Reflect.get(t, k, r);
        if (k === 'bind') return (...a: unknown[]) => wrap((t.bind as (...x: unknown[]) => D1PreparedStatement)(...a), sql, a);
        if ((k === 'all' || k === 'first') && isCacheable(sql)) {
          return async (...a: unknown[]) => {
            const ver = await version();
            if (!ver) return (v as (...x: unknown[]) => Promise<unknown>).apply(t, a);
            const req = await keyFor(ver, `${String(k)}:${JSON.stringify(a)}`, sql, params);
            const hit = await read<{ v: unknown }>(req);
            if (hit) return hit.v;
            const out = await (v as (...x: unknown[]) => Promise<unknown>).apply(t, a);
            await write(req, { v: out });
            return out;
          };
        }
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    meta.set(px, { sql, params, inner });
    return px;
  }

  return new Proxy(db, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (k === 'prepare') return (sql: string) => wrap(t.prepare(sql), sql, []);
      if (k === 'batch') {
        return async (stmts: D1PreparedStatement[]) => {
          const infos = stmts.map((s) => meta.get(s));
          const ver = infos.some((i) => i && isCacheable(i.sql)) ? await version() : null;
          const out: unknown[] = new Array(stmts.length);
          const misses: number[] = [];
          const reqs: Array<Request | null> = new Array(stmts.length).fill(null);
          await Promise.all(stmts.map(async (_s, i) => {
            const info = infos[i];
            if (ver && info && isCacheable(info.sql)) {
              reqs[i] = await keyFor(ver, 'batch', info.sql, info.params);
              const hit = await read<{ v: unknown }>(reqs[i]!);
              if (hit) { out[i] = hit.v; return; }
            }
            misses.push(i);
          }));
          if (misses.length) {
            const res = await t.batch(misses.map((i) => (infos[i]?.inner ?? stmts[i]) as D1PreparedStatement));
            await Promise.all(misses.map(async (i, j) => { out[i] = res[j]; if (reqs[i]) await write(reqs[i]!, { v: res[j] }); }));
          }
          return out;
        };
      }
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}
