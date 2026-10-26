// Test harness: node:sqlite as a D1 stand-in over the real migrations, an in-memory R2, a routable fetch mock.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { D1Result, D1Stmt, Db, Deps, ImportEnv, R2Like, R2Obj } from '../../workers/import/src/deps';
import { runTick } from '../../workers/import/src/engine/tick';

const MIGRATIONS = join(import.meta.dirname, '../../migrations');

class Stmt implements D1Stmt {
  constructor(private raw: DatabaseSync, public sql: string, private params: unknown[] = []) {}
  bind(...v: unknown[]) { return new Stmt(this.raw, this.sql, v.map((x) => (x === undefined ? null : x))); }
  async all<T>() { const rows = this.raw.prepare(this.sql).all(...(this.params as never[])) as T[]; return { results: rows, meta: {} } as D1Result<T>; }
  async first<T>() { const r = this.raw.prepare(this.sql).get(...(this.params as never[])) as T | undefined; return r ?? null; }
  async run() { const r = this.raw.prepare(this.sql).run(...(this.params as never[])); return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } } as D1Result; }
}

export function makeDb(): { db: Db; raw: DatabaseSync; sqlLog: string[] } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  const sqlLog: string[] = [];
  const db: Db = {
    prepare: (sql) => { sqlLog.push(sql); return new Stmt(raw, sql); },
    async batch(stmts) {
      raw.exec('BEGIN');
      try { const out: D1Result[] = []; for (const s of stmts) out.push(await s.run()); raw.exec('COMMIT'); return out; }
      catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  };
  return { db, raw, sqlLog };
}

export function makeR2(): R2Like & { store: Map<string, Uint8Array> } {
  const store = new Map<string, Uint8Array>();
  const toBytes = async (v: string | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>): Promise<Uint8Array> => {
    if (typeof v === 'string') return new TextEncoder().encode(v);
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    return new Uint8Array(await new Response(v).arrayBuffer());
  };
  const etagOf = (b: Uint8Array) => { let h = 5381; for (const x of b) h = ((h << 5) + h + x) >>> 0; return `"${h.toString(16)}-${b.length}"`; };
  return {
    store,
    async get(key) {
      const b = store.get(key); if (!b) return null;
      const o: R2Obj = { key, size: b.length, etag: etagOf(b), uploaded: new Date(), body: new Response(b).body!, text: async () => new TextDecoder().decode(b) };
      return o;
    },
    async put(key, value) { const b = await toBytes(value); store.set(key, b); return { etag: etagOf(b) }; },
    async list({ prefix }) { return { objects: [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, b]) => ({ key, uploaded: new Date(), size: b.length })), truncated: false }; },
    async delete(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k); },
  };
}

export type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>;
export interface Harness { deps: Deps; raw: DatabaseSync; db: Db; r2: ReturnType<typeof makeR2>; env: ImportEnv; routes: Map<string, Route>; fetchLog: string[]; sleeps: number[]; sqlLog: string[]; setNow(d: Date): void; logs: string[] }

export const NOW = new Date('2026-10-26T02:00:00Z'); // 03:00 in Prague, inside the 0-7 import window
export const FEED_HOST = 'feeds.example.test';
export const SECRET_TOKEN = 'SECRET-TOKEN-123';

export function makeHarness(over: Partial<ImportEnv> = {}): Harness {
  const { db, raw, sqlLog } = makeDb();
  const r2 = makeR2();
  const routes = new Map<string, Route>();
  const fetchLog: string[] = []; const sleeps: number[] = []; const logs: string[] = [];
  let now = NOW;
  const env: ImportEnv = { DB: db, SNAPSHOTS: r2, IMPORT_SHARED_SECRET: 'x'.repeat(32), ALLOWED_FEED_HOSTS: `${FEED_HOST},ads.api.cj.com`, IMPORT_WINDOW: '0-7', ...over };
  const deps: Deps = {
    env, now: () => now, sleep: async (ms) => { sleeps.push(ms); }, budgetMs: 60_000,
    log: (e, d) => logs.push(JSON.stringify({ e, ...d })),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url);
      fetchLog.push(u.host + u.pathname);
      const route = routes.get(u.host + u.pathname);
      if (!route) return new Response('not found', { status: 404 });
      return route(u, init);
    }) as typeof fetch,
  };
  return { deps, raw, db, r2, env, routes, fetchLog, sleeps, sqlLog, logs, setNow: (d) => { now = d; } };
}

export function addFeed(h: Harness, o: { id: number; partner?: string; adapter: string; type?: 'hotels' | 'products'; full?: number; mapping?: object; kind?: string; interval?: number; secretUrl?: string; affiliate?: string }) {
  h.raw.prepare('INSERT OR IGNORE INTO partners (slug, name) VALUES (?, ?)').run(o.partner ?? 'testck', o.partner ?? 'testck');
  h.raw.prepare('INSERT INTO feeds (id, name, partner_slug, adapter, content_type, is_full_catalogue, source_ref, mapping_json, source_kind, interval_hours, affiliate_params) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(o.id, `feed ${o.id}`, o.partner ?? 'testck', o.adapter, o.type ?? 'hotels', o.full ?? 1, `FEED_URL_${o.id}`, JSON.stringify(o.mapping ?? {}), o.kind ?? 'http', o.interval ?? 12, o.affiliate ?? '');
  (h.env as Record<string, unknown>)[`FEED_URL_${o.id}`] = o.secretUrl ?? `https://${FEED_HOST}/f${o.id}.xml?token=${SECRET_TOKEN}`;
}
export const serve = (h: Harness, feedId: number, body: string | (() => Response) | Uint8Array, init: ResponseInit = {}) =>
  h.routes.set(`${FEED_HOST}/f${feedId}.xml`, () => (typeof body === 'function' ? body() : new Response(body as BodyInit, { status: 200, ...init })));

export const rows = <T = Record<string, unknown>>(h: Harness, sql: string, ...p: unknown[]) => h.raw.prepare(sql).all(...(p as never[])) as T[];
export const one = <T = Record<string, unknown>>(h: Harness, sql: string, ...p: unknown[]) => h.raw.prepare(sql).get(...(p as never[])) as T;

/** Run the cron tick until every queued feed finished (bounded). */
export async function tickAll(h: Harness) { const out = []; for (let i = 0; i < 20; i++) { const r = await runTick(h.deps); out.push(...r); if (!r.some((x) => x.status === 'continue')) break; } return out; }

// ---- synthetic feeds (dovolena_hotels preset: nested hotel/offers with ids, stable per item) -----------------------
export interface FxOffer { id: string; price?: number | string; from?: string; to?: string; days?: number; food?: string; url?: string; airport?: string }
export interface FxHotel { id: string; name: string; country?: string; locality?: string; stars?: number; gps?: string; desc?: string; images?: string[]; offers: FxOffer[] }
export function dovolenaXml(hotels: FxHotel[]): string {
  const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<hotels>${hotels.map((h) => `<hotel id="${h.id}"><name>${x(h.name)}</name><destination><country>${x(h.country ?? 'Řecko')}</country><locality>${x(h.locality ?? 'Kréta')}</locality></destination><category>${h.stars ?? 4}</category><gps>${h.gps ?? '35.30, 25.10'}</gps><description><![CDATA[${h.desc ?? 'Synthetic test hotel with a reasonably long description that is used only in tests of the importer.'}]]></description><gallery>${(h.images ?? ['https://img.example.test/' + h.id + '/1.jpg']).map((i) => `<image>${i}</image>`).join('')}</gallery><offers>${h.offers.map((o) => `<offer id="${o.id}" days="${o.days ?? 8}"><price>${o.price ?? 15990}</price><date_from>${o.from ?? '2026-12-05'}</date_from><date_to>${o.to ?? '2026-12-12'}</date_to><food>${o.food ?? 'all inclusive'}</food><transport>letecky</transport><airport>${o.airport ?? 'Praha'}</airport><url>${o.url ?? `https://partner.example.test/o/${o.id}`}</url></offer>`).join('')}</offers></hotel>`).join('')}</hotels>`;
}
/** N hotels with one offer each (ids h1..hN / o1..oN). */
export function manyHotels(n: number, price = 15990, start = 1): FxHotel[] {
  return Array.from({ length: n }, (_, i) => ({ id: `h${start + i}`, name: `Hotel Test ${start + i}`, locality: `Place ${(start + i) % 7}`, gps: `${35 + ((start + i) % 5)}.10, 25.2${(start + i) % 9}`, offers: [{ id: `o${start + i}`, price }] }));
}
