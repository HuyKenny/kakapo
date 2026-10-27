// Hotel lifecycle: a hotel without any live offer for HOTEL_RETIRE_DAYS is retired (its URL gets a 301 to the most relevant live
// category, see redirectTarget) and comes back by itself when an offer returns (reactivateRetired). Rows are never deleted:
// the slug and dedup_key stay reserved, so a returning hotel is not duplicated and a retired URL can never shadow a new page.
import type { Db, D1Stmt } from '../deps';
import { HOTEL_RETIRE_DAYS } from '../../../../src/lib/hotel/retention';
import { COUNTRY_PREFIX_ALIASES } from '../../../../src/lib/landing/country-aliases';
import { MIN_INDEX_RESULTS } from '../../../../src/lib/landing/meta';
import { chunk, runBatches, selectIn } from './db';
import { sqlTime } from '../util/text';

export interface RetireReport { candidates: number; retired: number; byTarget: Record<string, number>; sample: Array<{ from: string; to: string }> }
interface Cand { id: number; slug: string; country_slug: string; destination_slug: string }

const canonicalCountry = (c: string) => COUNTRY_PREFIX_ALIASES[c] ?? c;

/** Destination listing → country listing → /zajezdy/, each only when it has enough live hotels to be an indexable, useful page. */
export function redirectTarget(h: { country_slug: string; destination_slug: string }, dest: Map<string, number>, country: Map<string, number>): string {
  const c = canonicalCountry(String(h.country_slug ?? '')); const d = String(h.destination_slug ?? '');
  if (c && d && (dest.get(`${c}/${d}`) ?? 0) >= MIN_INDEX_RESULTS) return `/${c}/${d}/`;
  if (c && (country.get(c) ?? 0) >= MIN_INDEX_RESULTS) return `/${c}/`;
  return '/zajezdy/';
}

export async function retireHotels(db: Db, o: { now: Date; dry?: boolean; limit?: number }): Promise<RetireReport> {
  const cutoff = sqlTime(new Date(o.now.getTime() - HOTEL_RETIRE_DAYS * 86400_000));
  const cands = (await db.prepare(`SELECT id, slug, country_slug, destination_slug FROM hotels
      WHERE hidden = 0 AND offers_active = 0 AND retired_at IS NULL AND COALESCE(offers_last_seen, created_at) < ?
      ORDER BY COALESCE(offers_last_seen, created_at) ASC, id LIMIT ?`).bind(cutoff, o.limit && o.limit > 0 ? o.limit : 50_000).all<Cand>()).results.filter((h) => /^[a-z0-9-]+$/.test(h.slug));
  const report: RetireReport = { candidates: cands.length, retired: 0, byTarget: {}, sample: [] };
  if (!cands.length) return report;

  const dest = new Map<string, number>(); const country = new Map<string, number>();
  for (const r of (await db.prepare("SELECT country_slug AS c, destination_slug AS d, COUNT(*) AS n FROM hotels WHERE offers_active > 0 AND hidden = 0 AND retired_at IS NULL GROUP BY country_slug, destination_slug").all<{ c: string; d: string; n: number }>()).results) {
    const c = canonicalCountry(r.c);
    country.set(c, (country.get(c) ?? 0) + r.n);
    if (r.d) dest.set(`${c}/${r.d}`, (dest.get(`${c}/${r.d}`) ?? 0) + r.n);
  }

  const nowSql = sqlTime(o.now);
  const stmts: D1Stmt[] = [];
  for (const h of cands) {
    const to = redirectTarget(h, dest, country);
    const kind = to === '/zajezdy/' ? '/zajezdy/' : to.split('/').filter(Boolean).length === 1 ? 'country' : 'destination';
    report.byTarget[kind] = (report.byTarget[kind] ?? 0) + 1;
    if (report.sample.length < 12) report.sample.push({ from: `/hotel/${h.slug}/`, to });
    if (o.dry) continue;
    // never overwrite a manual/merge redirect; the retired flag is set either way so the job is idempotent
    stmts.push(db.prepare(`INSERT INTO redirects (from_path, to_path, status, reason, created_at) VALUES (?, ?, 301, 'retired', ?)
      ON CONFLICT(from_path) DO UPDATE SET to_path = excluded.to_path WHERE redirects.reason = 'retired'`).bind(`/hotel/${h.slug}/`, to, nowSql));
    stmts.push(db.prepare('UPDATE hotels SET retired_at = ? WHERE id = ?').bind(nowSql, h.id));
  }
  if (!o.dry) { await runBatches(db, stmts); report.retired = cands.length; }
  return report;
}

/** A retired hotel that has an active offer again: drop its redirect and the flag. `ids` limits the check (finalize of a feed). */
export async function reactivateRetired(db: Db, ids?: number[]): Promise<number> {
  const rows: Array<{ id: number; slug: string }> = ids
    ? await selectIn(db, 'SELECT id, slug FROM hotels WHERE retired_at IS NOT NULL AND offers_active > 0 AND id IN ({IN})', ids)
    : (await db.prepare('SELECT id, slug FROM hotels WHERE retired_at IS NOT NULL AND offers_active > 0').all<{ id: number; slug: string }>()).results;
  let n = 0;
  for (const part of chunk(rows, 25)) {
    await runBatches(db, part.flatMap((h) => [
      db.prepare("DELETE FROM redirects WHERE from_path = ? AND reason = 'retired'").bind(`/hotel/${h.slug}/`),
      db.prepare('UPDATE hotels SET retired_at = NULL WHERE id = ?').bind(h.id),
    ]));
    n += part.length;
  }
  return n;
}
