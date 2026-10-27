// Feed ↔ database parity after a complete feed run: (1) counts — every identifiable feed item either has an active row or was
// rejected, and nothing absent from the feed may stay active; (2) a sample of ~100 offers of the run is compared field by field
// (price, departure, nights) with what is stored. A warning never blocks the run; it is written to the run message (`PARITY:`)
// and /api/health turns it into an alert. It proves "database = last successful feed", not the partner's own website.
import type { Db, R2Like } from '../deps';
import type { BlockRecord } from '../model';
import { readBlock } from './blocks';
import { selectIn } from './db';

export interface Parity { present: number; activeAfter: number; rejected: number; sampled: number; mismatched: number; warn: boolean; note: string }
const SAMPLE = 100;

export async function checkParity(db: Db, r2: R2Like, feed: { id: number }, runId: number, blocks: number, presentCount: number, rejected: number): Promise<Parity> {
  const activeAfter = (await db.prepare('SELECT COUNT(*) AS n FROM offers WHERE feed_id = ? AND active = 1').bind(feed.id).first<{ n: number }>())?.n ?? 0;
  let sampled = 0, mismatched = 0;
  if (blocks > 0) {
    try {
      const recs = await readBlock(r2, feed.id, runId, Math.floor(blocks / 2));
      const last = new Map<string, { price_pp: number; departure_date: string; nights: number }>();
      for (const r of recs as BlockRecord[]) if (r.k === 'h') for (const o of r.offers) last.set(o.external_id, o);
      const sample = [...last.entries()].slice(0, SAMPLE);
      const rows = await selectIn<{ external_id: string; price_pp: number; departure_date: string; nights: number; active: number }>(
        db, 'SELECT external_id, price_pp, departure_date, nights, active FROM offers WHERE feed_id = ? AND external_id IN ({IN})', sample.map(([id]) => id), [feed.id]);
      const byId = new Map(rows.map((x) => [x.external_id, x]));
      for (const [id, o] of sample) {
        sampled++;
        const row = byId.get(id);
        if (!row || row.active !== 1 || row.price_pp !== o.price_pp || row.departure_date !== o.departure_date || row.nights !== o.nights) mismatched++;
      }
    } catch { /* a missing block only skips the sample; the counts still apply */ }
  }
  const slack = Math.max(5, Math.floor(presentCount * 0.01));
  const notes: string[] = [];
  if (activeAfter > presentCount) notes.push(`${activeAfter - presentCount} active offers are not in the feed`);
  if (presentCount - activeAfter > rejected + slack) notes.push(`${presentCount - activeAfter - rejected} feed items have no active offer (rejected ${rejected})`);
  if (sampled >= 20 && mismatched / sampled > 0.01) notes.push(`${mismatched}/${sampled} sampled offers differ from the feed`);
  return { present: presentCount, activeAfter, rejected, sampled, mismatched, warn: notes.length > 0, note: notes.join('; ') };
}
