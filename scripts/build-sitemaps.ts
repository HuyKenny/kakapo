// Build and store the sitemaps in site_cache from outside the Worker, through the D1 HTTP API (same code as the Worker uses).
// Usage: tsx scripts/build-sitemaps.ts <staging|production>
import { readFileSync } from 'node:fs';
import { rebuildSitemaps } from '../src/lib/sitemap.ts';

const envName = process.argv[2] ?? 'staging';
function readEnv(f: string) { const o: Record<string, string> = {}; for (const l of readFileSync('/home/kenny/ai/credentials/' + f, 'utf8').split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) o[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, ''); } return o; }
const cf = readEnv('.cloudflare-credentials.env'); const kk = readEnv('.kakapo-credentials.env');
const wr = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
const cfg = JSON.parse(wr).env[envName];
const dbId: string = cfg.d1_databases[0].database_id;
const base = envName === 'production' ? 'https://kakapo.cz' : cfg.vars.SITE_URL;
const url = `https://api.cloudflare.com/client/v4/accounts/${kk.CF_ACCOUNT_ID}/d1/database/${dbId}/query`;
const headers = { 'X-Auth-Email': cf.CF_EMAIL!, 'X-Auth-Key': (cf.CF_GLOBAL_API_KEY || cf.CF_API_KEY)!, 'Content-Type': 'application/json' };
async function q(sql: string, params: unknown[]): Promise<any[]> {
  for (let a = 1; ; a++) {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ sql, params }) });
    const j: any = await r.json();
    if (j.success) return j.result[0].results;
    if (a >= 4) throw new Error('D1 API: ' + JSON.stringify(j.errors).slice(0, 300));
    await new Promise((s) => setTimeout(s, 1500 * a));
  }
}
class Stmt { constructor(public sql: string, public p: unknown[] = []) {} bind(...v: unknown[]) { return new Stmt(this.sql, v); } async all() { return { results: await q(this.sql, this.p) }; } async first() { return (await q(this.sql, this.p))[0] ?? null; } async run() { await q(this.sql, this.p); return { results: [], meta: {} }; } }
const db = { prepare: (s: string) => new Stmt(s), async batch(st: Stmt[]) { const out = []; for (const s of st) out.push(await s.all()); return out; } } as unknown as D1Database;
const t0 = Date.now();
console.log(JSON.stringify(await rebuildSitemaps(db, base)), `${Math.round((Date.now() - t0) / 1000)}s`);
