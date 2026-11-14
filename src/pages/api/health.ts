// GET /api/health — monitoring for cron-job.org (30 min): 200 when imports are fresh, 503 with reasons otherwise. No secrets, no PII.
import type { APIRoute } from 'astro';
import { getEnv } from '../../lib/server/env';
import { STALE_GRACE_HOURS } from '../../lib/offers/eligibility';
import { countHotels, normalizeFilters } from '../../lib/search';

export const prerender = false;
const MAX_AGE_H = 200; // imports run weekly (Sunday night UTC)
const MIN_OFFERS = 15_000;
const MIN_SELLABLE_HOTELS = 2_000; // what visitors actually see: hotels with a sellable offer (same rule as listings)

export const GET: APIRoute = async () => {
  const db = getEnv().DB;
  const reasons: string[] = [];
  const [feeds, offers, version] = await db.batch([
    db.prepare("SELECT MAX(last_success_at) AS last_ok, SUM(CASE WHEN enabled = 1 AND paused = 0 AND (last_success_at IS NULL OR last_success_at < datetime('now', '-' || ? || ' hours')) THEN 1 ELSE 0 END) AS stale FROM feeds").bind(MAX_AGE_H * 2),
    db.prepare('SELECT COUNT(*) AS n FROM offers WHERE active = 1'),
    db.prepare("SELECT updated_at FROM site_cache WHERE key = 'data_version'"),
  ]);
  // per feed: overdue (interval + STALE_GRACE_HOURS, the same limit that takes its offers out of sale), held by the size guard, parity warning of the latest run
  const [overdue, latest, hotels] = await db.batch([
    db.prepare("SELECT partner_slug AS p FROM feeds WHERE enabled = 1 AND paused = 0 AND content_type = 'hotels' AND (last_success_at IS NULL OR last_success_at < datetime('now', '-' || (interval_hours + ?) || ' hours'))").bind(STALE_GRACE_HOURS),
    db.prepare("SELECT f.partner_slug AS p, r.status AS st, substr(r.message, 1, 160) AS msg FROM feeds f JOIN import_runs r ON r.id = (SELECT MAX(id) FROM import_runs WHERE feed_id = f.id) WHERE f.enabled = 1 AND f.paused = 0 AND f.content_type = 'hotels' AND (r.status = 'suspicious' OR r.message LIKE 'PARITY:%')"),
    db.prepare("SELECT (SELECT COUNT(*) FROM hotels WHERE offers_active > 0 AND hidden = 0) AS live, (SELECT COUNT(*) FROM hotels WHERE retired_at IS NOT NULL) AS retired"),
  ]);
  const f = (feeds!.results as Array<{ last_ok: string | null; stale: number }>)[0];
  const n = Number((offers!.results as Array<{ n: number }>)[0]?.n ?? 0);
  const v = (version!.results as Array<{ updated_at: string }>)[0]?.updated_at ?? null;
  const ageH = (s: string | null) => (s ? (Date.now() - Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z')) / 3_600_000 : Infinity);
  if (ageH(f?.last_ok ?? null) > MAX_AGE_H) reasons.push(`no successful import for ${MAX_AGE_H} h`);
  if (n < MIN_OFFERS) reasons.push(`only ${n} active offers`);
  if (ageH(v) > MAX_AGE_H) reasons.push(`snapshots older than ${MAX_AGE_H} h`);
  for (const r of overdue!.results as Array<{ p: string }>) reasons.push(`feed ${r.p} overdue (its offers are out of sale)`);
  for (const r of latest!.results as Array<{ p: string; st: string; msg: string }>) reasons.push(r.st === 'suspicious' ? `feed ${r.p} held by the size guard` : `feed ${r.p} parity: ${r.msg}`);
  const sellable = await countHotels(db, normalizeFilters({}));
  if (sellable < MIN_SELLABLE_HOTELS) reasons.push(`only ${sellable} hotels with a sellable offer on listings`);
  const hc = (hotels!.results as Array<{ live: number; retired: number }>)[0];
  const body = { ok: reasons.length === 0, reasons, live_hotels: Number(hc?.live ?? 0), sellable_hotels: sellable, retired_hotels: Number(hc?.retired ?? 0), active_offers: n, last_import_ok: f?.last_ok ?? null, stale_feeds: Number(f?.stale ?? 0), data_version_at: v };
  return new Response(JSON.stringify(body), { status: body.ok ? 200 : 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
};
