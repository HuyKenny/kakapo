// Import Worker entry: cron tick (every 10 minutes), daily maintenance cron, and a small HTTP API protected by
// IMPORT_SHARED_SECRET (called through a service binding by the admin Worker or by the Malina Čedok job).
import type { Deps, ImportEnv } from './deps';
import { runTick } from './engine/tick';
import { approveRun, stepFeed } from './engine/run';
import { runDaily } from './engine/daily';
import { sqlTime } from './util/text';

const DAILY_CRON = '30 1 * * *';
const MAX_UPLOAD = 150 * 1024 * 1024;

export function makeDeps(env: ImportEnv, budgetMs = 9 * 60_000): Deps {
  return {
    env, now: () => new Date(), fetch: (i, init) => fetch(i, init), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), budgetMs,
    log: (event, data) => console.log(JSON.stringify({ event, ...data })), // never contains feed URLs or tokens
  };
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function audit(env: ImportEnv, action: string, target: string, detail = '') {
  await env.DB.prepare('INSERT INTO admin_audit (at, actor, action, target, detail) VALUES (?,?,?,?,?)').bind(sqlTime(new Date()), 'import-api', action, target, detail.slice(0, 300)).run();
}

export async function handle(request: Request, env: ImportEnv, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
  const secret = env.IMPORT_SHARED_SECRET ?? '';
  const auth = request.headers.get('authorization') ?? '';
  if (secret.length < 24 || !safeEqual(auth, `Bearer ${secret}`)) return json({ error: 'unauthorized' }, 401);
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');

  if (request.method === 'GET' && parts[0] === 'status') {
    const feeds = (await env.DB.prepare('SELECT id, name, partner_slug, adapter, enabled, paused, is_full_catalogue, current_run, last_success_at, last_success_count, next_run_at FROM feeds ORDER BY id').all()).results;
    const runs = (await env.DB.prepare('SELECT id, feed_id, started_at, finished_at, status, items_read, items_new, items_changed, items_unchanged, items_rejected, items_deactivated, rows_written, duration_ms, message FROM import_runs ORDER BY id DESC LIMIT 60').all()).results;
    return json({ feeds, runs });
  }
  if (parts[0] === 'daily' && request.method === 'POST') return json(await runDaily(makeDeps(env)));

  if (parts[0] === 'feeds' && /^\d+$/.test(parts[1] ?? '')) {
    const id = Number(parts[1]);
    const action = parts[2] ?? '';
    const exists = await env.DB.prepare('SELECT id FROM feeds WHERE id = ?').bind(id).first();
    if (!exists) return json({ error: 'unknown feed' }, 404);
    if (request.method === 'POST' && action === 'run') {
      await env.DB.prepare('UPDATE feeds SET force_run = 1, next_run_at = ? WHERE id = ?').bind(sqlTime(new Date()), id).run();
      await audit(env, 'feed.run', String(id));
      if (url.searchParams.get('now') === '1') ctx.waitUntil(stepFeed(makeDeps(env), id, Date.now() + 9 * 60_000));
      return json({ queued: true });
    }
    if (request.method === 'POST' && (action === 'pause' || action === 'resume')) {
      await env.DB.prepare('UPDATE feeds SET paused = ? WHERE id = ?').bind(action === 'pause' ? 1 : 0, id).run();
      await audit(env, `feed.${action}`, String(id));
      return json({ paused: action === 'pause' });
    }
    if (request.method === 'POST' && action === 'approve') {
      await audit(env, 'feed.approve', String(id));
      return json(await approveRun(makeDeps(env), id, Date.now() + 9 * 60_000));
    }
    if (request.method === 'PUT' && action === 'snapshot') {
      // Čedok slim feed (or any r2-sourced feed) uploaded by the Malina job; the next tick imports it ahead of the night window.
      const len = Number(request.headers.get('content-length') ?? 0);
      if (!request.body || !(len > 100) || len > MAX_UPLOAD) return json({ error: 'content-length must be between 100 B and 150 MB' }, 400);
      await env.SNAPSHOTS.put(`inbox/feed-${id}.xml`, request.body);
      await env.DB.prepare('UPDATE feeds SET force_run = 1, next_run_at = ? WHERE id = ?').bind(sqlTime(new Date()), id).run();
      await audit(env, 'feed.snapshot', String(id), `${len} bytes`);
      return json({ stored: true, bytes: len });
    }
  }
  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request: Request, env: ImportEnv, ctx: ExecutionContext): Promise<Response> { return handle(request, env, ctx); },
  async scheduled(event: ScheduledController, env: ImportEnv, ctx: ExecutionContext): Promise<void> {
    const deps = makeDeps(env);
    ctx.waitUntil((event.cron === DAILY_CRON ? runDaily(deps) : runTick(deps)).then((r) => deps.log('cron.done', { cron: event.cron, n: Array.isArray(r) ? r.length : 1 })));
  },
};

// minimal ambient types so the file compiles without @cloudflare/workers-types
declare interface ScheduledController { cron: string }
declare interface ExecutionContext { waitUntil(p: Promise<unknown>): void }
