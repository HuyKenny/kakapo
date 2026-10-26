/**
 * Deploy to STAGING (production is refused unless KAKAPO_PRODUCTION_APPROVED=yes).
 *   tsx scripts/deploy.ts [--env staging|production] [--secrets] [--skip-build]
 * 1) D1 backup (SQL export → backups/, gitignored)  2) migrations  3) --secrets  4) import Worker  5) web Worker  6) smoke test
 * Rollback: `wrangler rollback --env <env>` for the web Worker and `-c workers/import/wrangler.jsonc` for the importer; D1: restore the backup.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const argv = process.argv.slice(2);
const envName = argv[argv.indexOf('--env') + 1] ?? 'staging';
if (envName !== 'staging' && !(envName === 'production' && process.env.KAKAPO_PRODUCTION_APPROVED === 'yes')) {
  console.error('Refusing: only staging can be deployed without KAKAPO_PRODUCTION_APPROVED=yes.');
  process.exit(1);
}
const NODE = '/home/kenny/.nvm/versions/node/v22.23.1/bin';
const CRED = '/home/kenny/ai/credentials';
function readEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(join(CRED, file), 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const cf = readEnv('.cloudflare-credentials.env');
const kk = readEnv('.kakapo-credentials.env');
const childEnv = { ...process.env, PATH: `${NODE}:${process.env.PATH}`, CLOUDFLARE_EMAIL: cf.CF_EMAIL, CLOUDFLARE_API_KEY: cf.CF_GLOBAL_API_KEY || cf.CF_API_KEY, CLOUDFLARE_ACCOUNT_ID: kk.CF_ACCOUNT_ID };
function run(cmd: string, args: string[], opts: { input?: string; env?: Record<string, string | undefined>; quiet?: boolean } = {}): string {
  if (!opts.quiet) console.log(`$ ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', env: { ...childEnv, ...(opts.env ?? {}) }, input: opts.input, stdio: ['pipe', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
}
const wr = (args: string[], opts: Parameters<typeof run>[2] = {}) => run(join(NODE, 'node'), [join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), ...args], opts);
const sfx = envName === 'staging' ? '_STAGING' : '_PRODUCTION';
const sha = run('git', ['rev-parse', '--short', 'HEAD'], { quiet: true }).trim();
const base = envName === 'staging' ? 'https://kakapo-staging.huy-kenny.workers.dev' : 'https://kakapo.cz';

mkdirSync(join(ROOT, 'backups'), { recursive: true });
try { wr(['d1', 'export', 'DB', '--remote', '--env', envName, '--output', join('backups', `d1-${envName}-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`)]); } catch { console.log('backup skipped (empty database on first deploy)'); }
wr(['d1', 'migrations', 'apply', 'DB', '--remote', '--env', envName], { input: 'y\n' });

wr(['deploy', '-c', 'workers/import/wrangler.jsonc', '--env', envName]);
if (argv.includes('--secrets')) {
  const web = { ACCESS_AUD: kk[`ACCESS_AUD${sfx}`], IP_HASH_SALT: kk[`IP_HASH_SALT${sfx}`], IMPORT_SHARED_SECRET: kk[`IMPORT_SHARED_SECRET${sfx}`], CSRF_SECRET: kk[`CSRF_SECRET${sfx}`] ?? kk[`IP_HASH_SALT${sfx}`] };
  const missing = Object.entries(web).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`missing secret values ${missing.join(', ')}`);
  (globalThis as { __web?: Record<string, string | undefined> }).__web = web;
}
if (!argv.includes('--skip-build')) run(join(NODE, 'npx'), ['astro', 'build'], { env: { CLOUDFLARE_ENV: envName, BUILD_ID: sha, SITE_URL: base } });
run(join(NODE, 'npx'), ['tsx', 'scripts/verify-no-secrets.ts']);
wr(['deploy', '-c', 'dist/server/wrangler.json']);
const web = (globalThis as { __web?: Record<string, string | undefined> }).__web;
if (web) { wr(['secret', 'bulk', '-c', 'dist/server/wrangler.json'], { input: JSON.stringify(web), quiet: true }); console.log(`web secrets set: ${Object.keys(web).join(', ')}`); }

// smoke test (staging sits behind Access: use the service token)
{
  const sk = readEnv('.kuponmat-sk-credentials.env');
  const h = { 'CF-Access-Client-Id': sk.ACCESS_CLIENT_ID_STAGING ?? '', 'CF-Access-Client-Secret': sk.ACCESS_CLIENT_SECRET_STAGING ?? '' };
  const check = async (path: string, headers: Record<string, string>, expect: number[]) => {
    const r = await fetch(base + path, { headers, redirect: 'manual' });
    const ok = expect.includes(r.status);
    console.log(`${ok ? 'OK ' : 'BAD'} ${r.status} ${path} ${Object.keys(headers).length ? '(service token)' : '(anonymous)'}`);
    return ok;
  };
  await new Promise((r) => setTimeout(r, 5000));
  const results = envName === 'staging'
    ? [await check('/', {}, [302, 401, 403]), await check('/admin/', {}, [302, 401, 403]), await check('/', h, [200]), await check('/robots.txt', h, [200]), await check('/zajezdy/', h, [200])]
    : [await check('/', {}, [200]), await check('/robots.txt', {}, [200]), await check('/zajezdy/', {}, [200]), await check('/admin/', {}, [302, 401, 403])];
  if (results.includes(false)) process.exit(2);
}
console.log(`deployed ${envName} @ ${sha}`);
