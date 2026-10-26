// GET /api/health — monitoring for cron-job.org (30 min): 200 when imports are fresh, 503 with reasons otherwise. No secrets, no PII.
import type { APIRoute } from 'astro';
import { getEnv } from '../../lib/server/env';

export const prerender = false;
const MAX_AGE_H = 26;
const MIN_OFFERS = 15_000;

export const GET: APIRoute = async () => {
  const db = getEnv().DB;
  const reasons: string[] = [];
  const [feeds, offers, version] = await db.batch([
    db.prepare("SELECT MAX(last_success_at) AS last_ok, SUM(CASE WHEN enabled = 1 AND paused = 0 AND (last_success_at IS NULL OR last_success_at < datetime('now', '-' || ? || ' hours')) THEN 1 ELSE 0 END) AS stale FROM feeds").bind(MAX_AGE_H * 2),
    db.prepare('SELECT COUNT(*) AS n FROM offers WHERE active = 1'),
    db.prepare("SELECT updated_at FROM site_cache WHERE key = 'data_version'"),
  ]);
  const f = (feeds!.results as Array<{ last_ok: string | null; stale: number }>)[0];
  const n = Number((offers!.results as Array<{ n: number }>)[0]?.n ?? 0);
  const v = (version!.results as Array<{ updated_at: string }>)[0]?.updated_at ?? null;
  const ageH = (s: string | null) => (s ? (Date.now() - Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z')) / 3_600_000 : Infinity);
  if (ageH(f?.last_ok ?? null) > MAX_AGE_H) reasons.push(`no successful import for ${MAX_AGE_H} h`);
  if (n < MIN_OFFERS) reasons.push(`only ${n} active offers`);
  if (ageH(v) > MAX_AGE_H) reasons.push(`snapshots older than ${MAX_AGE_H} h`);
  const body = { ok: reasons.length === 0, reasons, active_offers: n, last_import_ok: f?.last_ok ?? null, stale_feeds: Number(f?.stale ?? 0), data_version_at: v };
  return new Response(JSON.stringify(body), { status: body.ok ? 200 : 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
};
