// Read-only export of the kakapo tables via the plugin's /maintenance/export endpoint to NDJSON files.
// Usage: tsx scripts/export-from-wp.ts <out-dir> [--offers-active-only]
// Credentials: /home/kenny/ai/credentials/.kakapo-credentials.env (never printed).
import { readFileSync, mkdirSync, createWriteStream, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CREDS = '/home/kenny/ai/credentials/.kakapo-credentials.env';
const env: Record<string, string> = {};
for (const line of readFileSync(CREDS, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, '');
}
const base = `${env.WP_URL}/wp-json/kakapo/v1/maintenance/export`;
const auth = 'Basic ' + Buffer.from(`${env.WP_USER}:${env.WP_APP_PASSWORD}`).toString('base64');
const out = process.argv[2];
if (!out) throw new Error('usage: export-from-wp.ts <out-dir>');
const activeOnly = process.argv.includes('--offers-active-only');
mkdirSync(out, { recursive: true });

async function get(params: Record<string, string | number>): Promise<any> {
  const url = `${base}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`;
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, { headers: { Authorization: auth, 'User-Agent': 'Mozilla/5.0 kakapo-migration-export' } });
    if (r.ok) return r.json();
    if (attempt >= 4) throw new Error(`HTTP ${r.status} for table=${params.table}`);
    await new Promise((res) => setTimeout(res, 2000 * attempt));
  }
}

const manifest: Record<string, number> = {};
const plan: Array<[string, Record<string, string | number>]> = [
  ['hotels', {}], ['hotel_aliases', {}], ['feeds', {}], ['products', {}],
  ['offers', activeOnly ? { active: 1 } : {}], ['price_history', {}], ['import_logs', {}],
];
for (const [table, extra] of plan) {
  const file = createWriteStream(join(out, `${table}.ndjson`));
  let n = 0, cursor = 0;
  for (;;) {
    const p: Record<string, string | number> = { table, limit: 1000, ...extra };
    if (table === 'price_history') p.offset = cursor; else p.after = cursor;
    const page = await get(p);
    for (const row of page.rows) { file.write(JSON.stringify(row) + '\n'); n++; }
    if (page.next === null || page.next === undefined) break;
    cursor = page.next;
  }
  await new Promise((res) => file.end(res));
  manifest[table] = n;
  console.log(`${table}: ${n}`);
}
manifest.clicks = (await get({ table: 'clicks' })).count;
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ at: new Date().toISOString(), activeOnly, rows: manifest }, null, 2));
console.log('clicks (count only):', manifest.clicks);
