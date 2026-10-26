import { env as cfEnv } from 'cloudflare:workers';

export interface AppEnv {
  DB: D1Database;
  SNAPSHOTS?: R2Bucket;
  ASSETS?: Fetcher;
  IMPORTER?: Fetcher;
  RL_EVENTS?: RateLimit;
  RL_ADMIN?: RateLimit;
  RL_GO?: RateLimit;
  ENVIRONMENT?: string;
  SITE_URL?: string;
  ALLOWED_HOSTS?: string;
  RL_SEARCH?: RateLimit;
  REQUIRE_ACCESS_EVERYWHERE?: string;
  ANALYTICS_ENABLED?: string;
  GA4_ID?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_DEV_BYPASS?: string;
  CSRF_SECRET?: string;
  IP_HASH_SALT?: string;
  IMPORT_SHARED_SECRET?: string;
  GO_SECRET?: string;
}

/** Per-isolate D1 query counters (debug headers X-D1-* on non-production). */
export const d1Stats = { n: 0, ms: 0, slow: [] as string[] };
let wrapped: AppEnv | null = null;

const originals = new WeakMap<object, D1PreparedStatement>();
function timedDb(db: D1Database): D1Database {
  const wrapStmt = (st: D1PreparedStatement, sql: string): D1PreparedStatement => { const px: D1PreparedStatement = new Proxy(st, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (k === 'bind') return (...a: unknown[]) => wrapStmt((t.bind as (...x: unknown[]) => D1PreparedStatement)(...a), sql);
      if (k === 'all' || k === 'first' || k === 'run' || k === 'raw') {
        return async (...a: unknown[]) => {
          const t0 = Date.now();
          if ((globalThis as any).__D1_TRACE) console.log('Q> ' + sql.replace(/\s+/g, ' ').slice(0, 110));
          try { return await (v as (...x: unknown[]) => Promise<unknown>).apply(t, a); } finally {
            const dt = Date.now() - t0; d1Stats.n++; d1Stats.ms += dt;
            if ((globalThis as any).__D1_TRACE) console.log(`Q< ${dt}ms`);
            if (dt > 150 && d1Stats.slow.length < 8) d1Stats.slow.push(`${dt}ms ${sql.replace(/\s+/g, ' ').slice(0, 90)}`);
          }
        };
      }
      return typeof v === 'function' ? v.bind(t) : v;
    },
  }); originals.set(px, st); return px; };
  return new Proxy(db, { get(t, k, r) { const v = Reflect.get(t, k, r); if (k === 'prepare') return (sql: string) => wrapStmt(t.prepare(sql), sql); if (k === 'batch') return async (stmts: D1PreparedStatement[]) => { const t0 = Date.now(); if ((globalThis as any).__D1_TRACE) console.log(`B> ${stmts.length} stmts`); try { return await t.batch(stmts.map((x) => originals.get(x) ?? x)); } finally { d1Stats.n++; d1Stats.ms += Date.now() - t0; if ((globalThis as any).__D1_TRACE) console.log(`B ${stmts.length} stmts ${Date.now() - t0}ms`); } }; return typeof v === 'function' ? v.bind(t) : v; } });
}

export function getEnv(): AppEnv {
  const e = cfEnv as unknown as AppEnv;
  (globalThis as any).__D1_TRACE = e.ENVIRONMENT === 'staging';
  if (e.ENVIRONMENT === 'production') return e;
  return (wrapped ??= Object.assign(Object.create(Object.getPrototypeOf(e)), e, { DB: timedDb(e.DB) }));
}

/** local/test only — never true in staging/production even if a variable leaks in. */
export function isLocal(e: AppEnv = getEnv()): boolean {
  return e.ENVIRONMENT === 'local' || e.ENVIRONMENT === 'test';
}

export function siteUrl(e: AppEnv = getEnv()): string {
  return (e.SITE_URL || 'https://kakapo.cz').replace(/\/$/, '');
}

export function isProduction(e: AppEnv = getEnv()): boolean {
  return e.ENVIRONMENT === 'production';
}

export function allowedHosts(e: AppEnv = getEnv()): string[] {
  return (e.ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
