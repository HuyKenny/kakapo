/**
 * Nightly import for the static site (Cloudflare Workers Free, 2026-11): runs the code of workers/import (the deleted
 * kakapo-import Worker) in Node over the local SQLite state instead of D1/R2.
 *
 *   tsx scripts/static/run-import.ts --db <sqlite file> --inbox <dir> [--daily] [--only 1,2,41] [--budget-min 60]
 *
 * --inbox  directory with uploaded snapshots: feed-41.xml (Čedok slim), feed-43.xml + feed-44.xml (ATIS slim), produced by
 *          the `feeds` job of .github/workflows/static.yml (scripts of the public repo HuyKenny/kakapo-feeds).
 * --daily  also run the daily maintenance (expire departed offers, aggregates, price history, retire, snapshots, sitemaps).
 * Secrets come from the environment (GitHub Secrets): CJ_API_TOKEN, CJ_CID, CJ_PID, FEED_URL_<feed id>. A feed without its
 * secret fails with "secret FEED_URL_<id> is not set" and keeps its previous data. Prints counts only (public Actions log).
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { D1Result, D1Stmt, Db, Deps, ImportEnv, R2Like, R2Obj } from '../../workers/import/src/deps';
import { stepFeed } from '../../workers/import/src/engine/run';
import { runDaily } from '../../workers/import/src/engine/daily';
import { afterTick } from '../../workers/import/src/engine/post';
import { sqlTime } from '../../workers/import/src/util/text';
import { rebuildSnapshots } from '../../src/lib/snapshots';
import { rebuildSitemaps } from '../../src/lib/sitemap';

const argv = process.argv.slice(2);
const arg = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const file = arg('--db');
const inbox = arg('--inbox');
if (!file || !existsSync(file)) throw new Error('usage: run-import.ts --db <sqlite> --inbox <dir> [--daily] [--only 1,2]');
const only = arg('--only')?.split(',').map(Number);
const budgetMs = Number(arg('--budget-min') ?? 75) * 60_000;

class Stmt implements D1Stmt {
  constructor(private raw: DatabaseSync, private sql: string, private params: unknown[] = []) {}
  bind(...v: unknown[]) { return new Stmt(this.raw, this.sql, v.map((x) => (x === undefined ? null : typeof x === 'boolean' ? Number(x) : x))); }
  async all<T>() { return { results: this.raw.prepare(this.sql).all(...(this.params as never[])) as T[], meta: {} } as D1Result<T>; }
  async first<T>() { return ((this.raw.prepare(this.sql).get(...(this.params as never[])) as T | undefined) ?? null); }
  async run() { const r = this.raw.prepare(this.sql).run(...(this.params as never[])); return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } } as D1Result; }
}

const raw = new DatabaseSync(file);
raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
const db: Db = {
  prepare: (sql) => new Stmt(raw, sql),
  async batch(stmts) {
    raw.exec('BEGIN');
    try { const out: D1Result[] = []; for (const s of stmts) out.push(await s.run()); raw.exec('COMMIT'); return out; }
    catch (e) { raw.exec('ROLLBACK'); throw e; }
  },
};

/** R2 stand-in on the local disk: inbox/feed-<id>.xml from --inbox, run blocks in a scratch directory next to it. */
function dirR2(root: string): R2Like {
  const path = (key: string) => join(root, key);
  const toBytes = async (v: string | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>): Promise<Uint8Array> => {
    if (typeof v === 'string') return new TextEncoder().encode(v);
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    return new Uint8Array(await new Response(v).arrayBuffer());
  };
  const walk = (dir: string, prefix: string, out: string[]) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p, `${prefix}${f}/`, out); else out.push(prefix + f);
    }
  };
  return {
    async get(key) {
      const p = path(key);
      if (!existsSync(p)) return null;
      const b = readFileSync(p);
      const st = statSync(p);
      const o: R2Obj = { key, size: b.length, etag: `"${st.mtimeMs}-${b.length}"`, uploaded: st.mtime, body: new Response(b).body!, text: async () => b.toString('utf8') };
      return o;
    },
    async put(key, value) { const b = await toBytes(value); mkdirSync(dirname(path(key)), { recursive: true }); writeFileSync(path(key), b); return { etag: `"${b.length}"` }; },
    async list({ prefix }) {
      const all: string[] = []; walk(root, '', all);
      const objects = all.filter((k) => k.startsWith(prefix)).map((key) => { const st = statSync(path(key)); return { key, uploaded: st.mtime, size: st.size }; });
      return { objects, truncated: false };
    },
    async delete(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) rmSync(path(k), { force: true }); },
  };
}

const r2root = join(dirname(file), 'r2');
mkdirSync(join(r2root, 'inbox'), { recursive: true });
// the uploaded slim feeds of this night; a feed whose file is missing keeps its previous data ("no uploaded snapshot")
for (const f of readdirSync(join(r2root, 'inbox'))) rmSync(join(r2root, 'inbox', f), { force: true });
if (inbox && existsSync(inbox)) {
  for (const f of readdirSync(inbox)) if (/^feed-\d+\.xml(\.gz)?$/.test(f) && statSync(join(inbox, f)).size > 100) writeFileSync(join(r2root, 'inbox', f), readFileSync(join(inbox, f)));
}

const env = {
  DB: db,
  SNAPSHOTS: dirR2(r2root),
  ALLOWED_FEED_HOSTS: 'ads.api.cj.com,*.invia.cz,*.dovolena.cz,*.slevomat.cz,*.skrz.cz,*.excursia.cz,*.zazitky.cz,*.radynacestu.cz,*.adrop.cz,export.ceskekormidlo.cz,feeds.mergado.com,www.atis.cz',
  SITE_URL: 'https://kakapo.cz',
  IMPORT_WINDOW: '',            // the workflow runs once a night: every due feed runs now
  MAX_DROP_PCT: '40',
  LAST_MINUTE_DAYS: '14',
  FIRST_MINUTE_DAYS: '120',
  WARM_ENABLED: '0',
  // no INDEXNOW_KEY: the ping runs after a successful deploy (scripts/static/indexnow.py, site.json post_deploy)
} as unknown as ImportEnv & Record<string, unknown>;
for (const [k, v] of Object.entries(process.env)) if (v && (/^FEED_URL_\d+$/.test(k) || /^CJ_(API_TOKEN|CID|PID)$/.test(k))) env[k] = v;
// all http feed URLs in one secret (they carry partner tokens): {"FEED_URL_5": "https://…", …}
if (process.env.FEED_URLS_JSON) {
  try { for (const [k, v] of Object.entries(JSON.parse(process.env.FEED_URLS_JSON) as Record<string, string>)) if (/^FEED_URL_\d+$/.test(k) && v) env[k] = v; }
  catch { console.log('FEED_URLS_JSON is not valid JSON - ignored'); }
}
console.log(`feed secrets: ${Object.keys(env).filter((k) => k.startsWith('FEED_URL_')).length} http feeds, CJ ${env.CJ_API_TOKEN ? 'set' : 'missing'}`);

// an inbox file feed-<id>.xml for an http feed is used instead of its URL for this run
const viaInbox: number[] = [];
for (const f of readdirSync(join(r2root, 'inbox'))) {
  const m = /^feed-(\d+)\.xml/.exec(f);
  const row = m ? raw.prepare("SELECT id FROM feeds WHERE id = ? AND source_kind = 'http'").get(Number(m[1])) as { id: number } | undefined : undefined;
  if (row) { raw.prepare("UPDATE feeds SET source_kind = 'r2' WHERE id = ?").run(row.id); viaInbox.push(row.id); }
}
if (viaInbox.length) console.log(`inbox files used for http feeds ${viaInbox.join(',')}`);
const counts = { hours: 0 };
const deps: Deps = {
  env, now: () => new Date(), fetch: (i, init) => fetch(i, init), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), budgetMs: 9 * 60_000,
  // the engine never logs feed URLs or tokens; keep only the summary events
  log: (event, data) => { if (/done|failed|error|hold|parity|indexnow|retire/i.test(event)) console.log(JSON.stringify({ event, ...data }).slice(0, 400)); },
};
void counts;

const t0 = Date.now();
const deadline = t0 + budgetMs;
// locks/runs left by the deleted Worker: the local copy has no concurrent writer
raw.exec('UPDATE feeds SET lock_until = NULL');
// a nightly run: every enabled feed that is due within the next 20 h
const due = raw.prepare(`SELECT id, name, current_run FROM feeds WHERE enabled = 1 AND paused = 0
  AND (current_run IS NOT NULL OR force_run = 1 OR next_run_at IS NULL OR next_run_at <= ?) ORDER BY id`).all(sqlTime(new Date(Date.now() + 20 * 3600_000))) as Array<{ id: number; name: string; current_run: number | null }>;
let failed = 0, ok = 0;
for (const f of due) {
  if (only && !only.includes(f.id)) continue;
  if (Date.now() > deadline) { console.log(`feed ${f.id}: skipped (time budget)`); continue; }
  const t = Date.now();
  let last = '';
  for (let i = 0; i < 400 && Date.now() < deadline; i++) {
    const r = await stepFeed(deps, f.id, Math.min(deadline, Date.now() + 9 * 60_000));
    last = r.status;
    if (r.status !== 'continue') { console.log(`feed ${f.id} ${f.name}: ${r.status}${r.message ? ' — ' + String(r.message).slice(0, 160) : ''} (${Math.round((Date.now() - t) / 1000)} s)`); break; }
  }
  if (/fail|error/.test(last)) failed++; else ok++;
}
await afterTick(deps);
if (argv.includes('--daily')) {
  const r = await runDaily({ ...deps, budgetMs: 30 * 60_000 });
  console.log('daily:', JSON.stringify(r));
}
for (const id of viaInbox) raw.prepare("UPDATE feeds SET source_kind = 'http' WHERE id = ?").run(id);
// sitemaps + snapshots from the final data (the tick rebuilt them before the daily expiry; daily only when older than 20 h)
await rebuildSnapshots(db as unknown as D1Database, new Date().toISOString());
const sm = await rebuildSitemaps(db as unknown as D1Database, 'https://kakapo.cz');
console.log('sitemaps rebuilt:', JSON.stringify(sm).slice(0, 200));
const n = (sql: string) => (raw.prepare(sql).get() as { n: number }).n;
console.log(`import: ${ok} feeds ok, ${failed} failed in ${Math.round((Date.now() - t0) / 1000)} s; active offers ${n('SELECT COUNT(*) n FROM offers WHERE active = 1')}, hotels with offers ${n('SELECT COUNT(*) n FROM hotels WHERE offers_active > 0')}, active products ${n('SELECT COUNT(*) n FROM products WHERE active = 1')}`);
raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
raw.close();
rmSync(join(r2root, 'inbox'), { recursive: true, force: true });
