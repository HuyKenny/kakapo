// Normalised blocks in R2: one NDJSON object per ~200 records plus a manifest. The apply phase receives only a block
// index; the raw feed is never kept (and never held in memory as a whole).
import type { R2Like } from '../deps';
import type { BlockRecord } from '../model';

export const BLOCK_RECORDS = 200;
export const runPrefix = (feedId: number, runId: number) => `snapshots/feed-${feedId}/run-${runId}/`;
export const blockKey = (feedId: number, runId: number, i: number) => `${runPrefix(feedId, runId)}block-${String(i).padStart(5, '0')}.ndjson`;
export const manifestKey = (feedId: number, runId: number) => `${runPrefix(feedId, runId)}manifest.json`;

export interface Manifest {
  blocks: number;
  hotels: number; offers: number; products: number;
  /** external ids seen in the feed (accepted + rejected-but-identifiable, never "past departure") — used for deactivation. */
  present: string[];
  rejected: number;
}

export class BlockWriter {
  private buf: string[] = [];
  private n = 0;
  constructor(private r2: R2Like, private feedId: number, private runId: number) {}
  get blocks() { return this.n; }
  async add(rec: BlockRecord) { this.buf.push(JSON.stringify(rec)); if (this.buf.length >= BLOCK_RECORDS) await this.flush(); }
  async flush() {
    if (!this.buf.length) return;
    await this.r2.put(blockKey(this.feedId, this.runId, this.n++), this.buf.join('\n') + '\n', { httpMetadata: { contentType: 'application/x-ndjson' } });
    this.buf = [];
  }
}

export async function readBlock(r2: R2Like, feedId: number, runId: number, i: number): Promise<BlockRecord[]> {
  const o = await r2.get(blockKey(feedId, runId, i));
  if (!o) throw new Error(`block ${i} of run ${runId} is missing in R2`);
  return (await o.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as BlockRecord);
}

export async function readManifest(r2: R2Like, feedId: number, runId: number): Promise<Manifest> {
  const o = await r2.get(manifestKey(feedId, runId));
  if (!o) throw new Error(`manifest of run ${runId} is missing in R2`);
  return JSON.parse(await o.text()) as Manifest;
}

/** Keep the newest `keep` runs per feed (the last good snapshot stays restorable); everything older is deleted. */
export async function pruneSnapshots(r2: R2Like, feedId: number, keepRunIds: number[]): Promise<number> {
  let cursor: string | undefined; const doomed: string[] = [];
  const keep = new Set(keepRunIds.map((id) => runPrefix(feedId, id)));
  do {
    const page = await r2.list({ prefix: `snapshots/feed-${feedId}/`, cursor });
    for (const o of page.objects) if (![...keep].some((p) => o.key.startsWith(p))) doomed.push(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  for (let i = 0; i < doomed.length; i += 500) await r2.delete(doomed.slice(i, i + 500));
  return doomed.length;
}
