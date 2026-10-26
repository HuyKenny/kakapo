// One-off repair (26. 10. 2026): feeds.affiliate_params were not migrated, so imports rebuilt partner URLs without
// our tracking (Čedok CJ wrapper, eHUB wrappers, Slevomat utm, Rady na cestu a_box). Sets the params on the feeds and
// rewrites existing offer/product URLs exactly like the importer (buildAffiliateUrl). Usage: tsx scripts/fix-affiliate-params.ts <env>
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildAffiliateUrl } from '../workers/import/src/adapters/normalize.ts';

const envName = process.argv[2] ?? 'staging';
const params: Record<string, string> = JSON.parse(readFileSync('/home/kenny/ai/tmp/feed-affparams.json', 'utf8'));
const TRACKED = /ehub\.cz\/system\/scripts\/click|anrdoezrs\.net|kqzyfj\.com|jdoqocy\.com|tkqlhce\.com|dpbolvw\.net|a_box=|utm_source=affiliate/;
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
const wr = (args: string[]) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--remote', '--env', envName, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const select = (sql: string) => JSON.parse(wr(['--command', sql, '--json']))[0].results as Array<{ id: number; feed_id: number; affiliate_url: string }>;

const sql: string[] = [];
const ids = Object.keys(params).filter((k) => params[k]);
for (const id of ids) sql.push(`UPDATE feeds SET affiliate_params = ${q(params[id]!)} WHERE id = ${Number(id)};`);
const feedList = ids.join(',');
let fixed = 0, skipped = 0;
for (const table of ['offers', 'products']) {
  for (const r of select(`SELECT id, feed_id, affiliate_url FROM ${table} WHERE active = 1 AND feed_id IN (${feedList})`)) {
    if (TRACKED.test(r.affiliate_url)) { skipped++; continue; }
    const url = buildAffiliateUrl(r.affiliate_url, params[String(r.feed_id)] ?? '');
    if (!url || url === r.affiliate_url) { skipped++; continue; }
    sql.push(`UPDATE ${table} SET affiliate_url = ${q(url)} WHERE id = ${r.id};`); fixed++;
  }
}
const file = `/home/kenny/ai/tmp/fix-affiliate-${envName}.sql`;
writeFileSync(file, sql.join('\n') + '\n');
console.log(`feeds ${ids.length}, urls to fix ${fixed}, already tracked/skipped ${skipped}`);
if (process.argv.includes('--apply')) { wr(['--file', file, '--yes']); console.log('applied'); }
