// One definition of "an offer we may sell today", used by listings, counts, hotel detail and the sitemap:
//  - active, departing today or later (Prague time),
//  - its feed delivered successfully recently — the allowed age depends on the feed's own interval (interval + 24 h),
//    so a partner whose import has been failing drops out instead of showing old prices as current.
// Feeds that never ran (migrated data) are not treated as stale. A temporary failure never deactivates offers by itself.
import { todayPrague } from '../search';

interface FeedAge { id: number; stale: boolean }
let memo: { at: number; stale: number[] } | null = null;

/** Feed ids whose last successful import is older than interval + 24 h. Memoised per isolate for 5 minutes. */
export async function staleFeedIds(db: D1Database): Promise<number[]> {
  if (memo && Date.now() - memo.at < 300_000) return memo.stale;
  let stale: number[] = [];
  try {
    const rows = (await db.prepare(
      "SELECT id, CASE WHEN last_success_at IS NOT NULL AND last_success_at < datetime('now', '-' || (interval_hours + 24) || ' hours') THEN 1 ELSE 0 END AS stale FROM feeds WHERE enabled = 1 AND content_type = 'hotels'",
    ).all<FeedAge>()).results;
    stale = rows.filter((r) => r.stale).map((r) => Number(r.id));
  } catch { /* table/column missing (tests) → nothing is stale */ }
  memo = { at: Date.now(), stale };
  return stale;
}
export const resetEligibilityMemo = () => { memo = null; };

/** SQL conditions on alias `o` (offers). `today` is a Prague YYYY-MM-DD literal built by us, never user input. */
export function sellableSql(stale: number[], today = todayPrague()): string[] {
  const out = ['o.active = 1', `o.departure_date >= '${/^\d{4}-\d{2}-\d{2}$/.test(today) ? today : todayPrague()}'`];
  const ids = stale.filter((n) => Number.isInteger(n));
  if (ids.length) out.push(`o.feed_id NOT IN (${ids.join(',')})`);
  return out;
}

/** JS twin of the same rule for already loaded rows (hotel detail, home blocks). */
export function isSellable(o: { active?: number | boolean; departure_date?: string; feed_id?: number; affiliate_url?: string }, stale: number[], today = todayPrague()): boolean {
  if (o.active === 0 || o.active === false) return false;
  if (!o.departure_date || o.departure_date < today) return false;
  if (o.feed_id !== undefined && stale.includes(Number(o.feed_id))) return false;
  return !o.affiliate_url || /^https:\/\//.test(o.affiliate_url);
}

/** Transport → what the visitor is told. 'neuvedeno' is a stay with no confirmed transport: never called a flight. */
export function transportLabel(t: string | null | undefined): string {
  switch (t) { case 'letecky': return 'letecky'; case 'autobusem': return 'autobusem'; case 'vlastni': return 'vlastní doprava'; default: return ''; }
}
export const isFlight = (t: string | null | undefined) => t === 'letecky';
