// Import state machine for one feed: download+normalise -> apply blocks -> finalize.
//   * download/normalise is atomic: any failure leaves the catalogue untouched (nothing is applied from a broken feed)
//   * apply is resumable per block (checkpoint in import_runs.checkpoint_json) and idempotent (content hashes)
//   * finalize deactivates missing offers only for a COMPLETE feed, only after everything was applied, and only below
//     the drop thresholds; a suspicious run is parked as status 'suspicious' for human approval
import type { Deps } from '../deps';
import type { BlockRecord, FeedRow, Rejection } from '../model';
import { openFeed, rotatingIds, FeedFetchError } from '../adapters';
import { finalizeProduct, mergeProducts, normalizeHotel, normalizeOffer, normalizeProduct, type NormCtx } from '../adapters/normalize';
import { XmlError } from '../xml/stream';
import { feedMapping } from '../adapters';
import { addDays, pragueToday, sqlTime } from '../util/text';
import { BlockWriter, manifestKey, pruneSnapshots, readBlock, readManifest, type Manifest } from './blocks';
import { MAX_PARAMS, chunk, qs, runBatches } from './db';
import { applyOffers, applyProducts, type RunCtx } from './offers';
import { recomputeAggregates, upsertHotels } from './hotels';
import { nextRunAt, parseWindow } from './schedule';
import type { NormProduct } from '../model';

export type StepStatus = 'ok' | 'not_modified' | 'failed' | 'suspicious' | 'continue' | 'locked' | 'skipped' | 'superseded';
export interface StepResult { feedId: number; runId: number | null; status: StepStatus; message?: string }

interface Counters { read: number; accepted: number; rejected: number; created: number; changed: number; unchanged: number; stale: number; hotelsCreated: number; rows: number; deactivated: number }
interface Checkpoint { phase: 'apply' | 'finalize' | 'held'; blocks: number; next: number; counters: Counters; etag: string | null; lastModified: string | null; startedMs: number; hold?: string; rejectedByReason?: Record<string, number> }

const LOCK_MS = 20 * 60_000;
const emptyCounters = (): Counters => ({ read: 0, accepted: 0, rejected: 0, created: 0, changed: 0, unchanged: 0, stale: 0, hotelsCreated: 0, rows: 0, deactivated: 0 });

const FEED_COLS = 'id, name, partner_slug, adapter, content_type, is_full_catalogue, source_ref, source_kind, affiliate_params, interval_hours, enabled, paused, force_run, mapping_json, format_preset, etag, last_modified, last_success_run, last_success_at, last_success_count, next_run_at, lock_until, current_run';

export async function loadFeed(deps: Deps, id: number): Promise<FeedRow | null> {
  return deps.env.DB.prepare(`SELECT ${FEED_COLS} FROM feeds WHERE id = ?`).bind(id).first<FeedRow>();
}

async function acquire(deps: Deps, feedId: number): Promise<boolean> {
  const now = sqlTime(deps.now());
  const r = await deps.env.DB.prepare('UPDATE feeds SET lock_until = ? WHERE id = ? AND (lock_until IS NULL OR lock_until < ?)').bind(sqlTime(new Date(deps.now().getTime() + LOCK_MS)), feedId, now).run();
  return (r.meta.changes ?? 0) === 1;
}
const release = (deps: Deps, feedId: number) => deps.env.DB.prepare('UPDATE feeds SET lock_until = NULL WHERE id = ?').bind(feedId).run();
const extendLock = (deps: Deps, feedId: number) => deps.env.DB.prepare('UPDATE feeds SET lock_until = ? WHERE id = ?').bind(sqlTime(new Date(deps.now().getTime() + LOCK_MS)), feedId).run();

async function saveRun(deps: Deps, runId: number, patch: Record<string, unknown>) {
  const cols = Object.keys(patch);
  await deps.env.DB.prepare(`UPDATE import_runs SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).bind(...cols.map((c) => patch[c] ?? null), runId).run();
}
const counterPatch = (c: Counters) => ({ items_read: c.read, items_new: c.created, items_changed: c.changed, items_unchanged: c.unchanged, items_rejected: c.rejected, items_deactivated: c.deactivated, rows_written: c.rows });

function lmDays(deps: Deps) { return Number(deps.env.LAST_MINUTE_DAYS ?? 14) || 14; }
function fmDays(deps: Deps) { return Number(deps.env.FIRST_MINUTE_DAYS ?? 120) || 120; }

/** One invocation of the state machine; call again while it returns 'continue'. */
export async function stepFeed(deps: Deps, feedId: number, deadline: number): Promise<StepResult> {
  const feed = await loadFeed(deps, feedId);
  if (!feed) return { feedId, runId: null, status: 'skipped', message: 'unknown feed' };
  if (!feed.enabled || feed.paused) return { feedId, runId: feed.current_run, status: 'skipped', message: 'disabled or paused' };
  if (!(await acquire(deps, feedId))) return { feedId, runId: feed.current_run, status: 'locked' };
  let runId: number | null = feed.current_run;
  try {
    let cp: Checkpoint | null = null;
    if (feed.current_run) {
      const run = await deps.env.DB.prepare('SELECT status, checkpoint_json FROM import_runs WHERE id = ?').bind(feed.current_run).first<{ status: string; checkpoint_json: string | null }>();
      cp = run?.status === 'running' && run.checkpoint_json ? (JSON.parse(run.checkpoint_json) as Checkpoint) : null;
      if (!cp) { // died while downloading: nothing was applied, start over
        await saveRun(deps, feed.current_run, { status: 'aborted', finished_at: sqlTime(deps.now()), message: 'interrupted before apply; restarted' });
        await deps.env.DB.prepare('UPDATE feeds SET current_run = NULL WHERE id = ?').bind(feedId).run();
        runId = null;
      }
    }
    if (!cp) {
      const started = await startRun(deps, feed);
      runId = started.runId;
      if (started.result) return started.result;
      cp = started.cp!;
    }
    return await continueRun(deps, feed, runId!, cp, deadline);
  } catch (e) {
    const msg = describeError(e);
    deps.log('import.failed', { feed: feedId, run: runId, error: msg });
    if (runId) {
      await saveRun(deps, runId, { status: 'failed', finished_at: sqlTime(deps.now()), message: msg.slice(0, 500) });
      await deps.env.DB.prepare('UPDATE feeds SET current_run = NULL, force_run = 0, next_run_at = ? WHERE id = ?').bind(retryAt(deps), feedId).run();
    }
    return { feedId, runId, status: 'failed', message: msg };
  } finally {
    await release(deps, feedId);
  }
}

const retryAt = (deps: Deps) => sqlTime(new Date(deps.now().getTime() + 30 * 60_000)); // failed feed: try again in 30 minutes
function describeError(e: unknown): string {
  if (e instanceof XmlError) return `xml ${e.code}: ${e.message}`;
  if (e instanceof FeedFetchError) return `fetch: ${e.message}`;
  return e instanceof Error ? e.message.replace(/https?:\/\/\S+/g, '<url>') : 'unknown error';
}

// ---- phase 1: download + normalise ---------------------------------------------------------------------------
async function startRun(deps: Deps, feed: FeedRow): Promise<{ runId: number; cp?: Checkpoint; result?: StepResult }> {
  const db = deps.env.DB;
  const t0 = Date.now();
  const ins = await db.prepare("INSERT INTO import_runs (feed_id, started_at, status) VALUES (?, ?, 'running')").bind(feed.id, sqlTime(deps.now())).run();
  const runId = ins.meta.last_row_id as number;
  await db.prepare('UPDATE feeds SET current_run = ? WHERE id = ?').bind(runId, feed.id).run();

  const opened = await openFeed(feed, deps);
  if (opened.notModified) {
    await saveRun(deps, runId, { status: 'ok', finished_at: sqlTime(deps.now()), duration_ms: Date.now() - t0, message: 'not modified (304 / same snapshot); catalogue untouched' });
    await db.prepare('UPDATE feeds SET current_run = NULL, force_run = 0, next_run_at = ?, last_success_at = ? WHERE id = ?').bind(nextRunAt(deps.now(), feed.interval_hours, parseWindow(deps.env.IMPORT_WINDOW)), sqlTime(deps.now()), feed.id).run();
    return { runId, result: { feedId: feed.id, runId, status: 'not_modified' } };
  }

  const mapping = feed.adapter.startsWith('cj-') ? null : feedMapping(feed);
  let cj: { force_type?: string; default_type?: string } = {};
  if (feed.adapter.startsWith('cj-')) { try { cj = JSON.parse(feed.mapping_json || '{}'); } catch { /* defaults */ } }
  const ctx: NormCtx = { today: pragueToday(deps.now()), affiliateParams: feed.adapter.startsWith('cj-') ? '' : feed.affiliate_params, lastMinuteDays: lmDays(deps), firstMinuteDays: fmDays(deps) };
  const popts = { defaultType: mapping?.default_type ?? cj.default_type ?? 'zajezdy', forceType: mapping?.force_type ?? cj.force_type ?? '' };

  const writer = new BlockWriter(deps.env.SNAPSHOTS, feed.id, runId);
  const present = new Set<string>();
  const products = new Map<string, NormProduct>();
  const c = emptyCounters();
  const reasons: Record<string, number> = {};
  const errors: Rejection[] = [];
  const reject = (r: Rejection) => {
    reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
    if (r.reason !== 'past_departure' && r.reason !== 'filtered') { c.rejected++; if (errors.length < 100) errors.push(r); }
    // a record we could identify but not accept keeps its offer alive; only past departures and filtered items may vanish
    if (r.external_id && r.reason !== 'past_departure' && r.reason !== 'filtered') present.add(r.external_id);
  };
  let hotels = 0, offers = 0;

  for await (const item of opened.items) {
    c.read++;
    if (item.t === 'bad') { reject({ external_id: item.external_id, reason: item.reason }); continue; }
    if (item.t === 'p') {
      const r = normalizeProduct(item.product, ctx, popts);
      if (!r.ok) { reject(r.rej); continue; }
      const prev = products.get(r.value.external_id);
      products.set(r.value.external_id, prev ? mergeProducts(prev, r.value) : r.value);
      present.add(r.value.external_id);
      continue;
    }
    const h = normalizeHotel(item.hotel);
    if (!h.ok) { reject({ external_id: null, reason: h.reason }); continue; }
    const good = [] as Array<import('../model').NormOffer>;
    for (const o of item.offers) {
      const n = normalizeOffer(o, ctx);
      if (n.ok) { good.push(n.value); present.add(n.value.external_id); } else reject(n.rej);
    }
    if (good.length) { await writer.add({ k: 'h', hotel: h.hotel, offers: good } as BlockRecord); hotels++; offers += good.length; }
  }
  for (const p of products.values()) await writer.add({ k: 'p', product: finalizeProduct(p) });
  await writer.flush();
  c.accepted = feed.content_type === 'products' ? products.size : offers;

  // sanity gates before anything touches the catalogue
  const reject_ratio = c.read > 0 ? c.rejected / c.read : 0;
  let hold: string | undefined;
  if (c.accepted === 0) throw new Error(`feed produced no valid items (read ${c.read}, rejected ${c.rejected})`);
  if (c.read >= 20 && reject_ratio > 0.5) throw new Error(`too many invalid records (${c.rejected}/${c.read}); mapping or feed format changed`);
  const maxDrop = Number(deps.env.MAX_DROP_PCT ?? 40) || 40;
  if (feed.is_full_catalogue && feed.last_success_count && feed.last_success_count >= 20 && c.accepted < feed.last_success_count * (1 - maxDrop / 100)) {
    hold = `suspicious drop: ${c.accepted} valid items vs ${feed.last_success_count} in the last good run (limit ${maxDrop}%)`;
  }
  const manifest: Manifest = { blocks: writer.blocks, hotels, offers, products: products.size, present: [...present], rejected: c.rejected };
  await deps.env.SNAPSHOTS.put(manifestKey(feed.id, runId), JSON.stringify(manifest), { httpMetadata: { contentType: 'application/json' } });
  if (errors.length) await runBatches(db, errors.map((e) => db.prepare('INSERT INTO import_errors (run_id, external_id, reason, created_at) VALUES (?,?,?,?)').bind(runId, e.external_id, e.reason, sqlTime(deps.now()))));

  const cp: Checkpoint = { phase: hold ? 'held' : 'apply', blocks: writer.blocks, next: 0, counters: c, etag: opened.etag, lastModified: opened.lastModified, startedMs: t0, hold, rejectedByReason: reasons };
  await saveRun(deps, runId, { checkpoint_json: JSON.stringify(cp), snapshot_key: `snapshots/feed-${feed.id}/run-${runId}/`, ...counterPatch(c) });
  if (hold) {
    await saveRun(deps, runId, { status: 'suspicious', finished_at: sqlTime(deps.now()), duration_ms: Date.now() - t0, message: hold });
    await db.prepare('UPDATE feeds SET current_run = NULL, force_run = 0, next_run_at = ? WHERE id = ?').bind(nextRunAt(deps.now(), feed.interval_hours, parseWindow(deps.env.IMPORT_WINDOW)), feed.id).run();
    return { runId, result: { feedId: feed.id, runId, status: 'suspicious', message: hold } };
  }
  return { runId, cp };
}

// ---- phase 2 + 3 ---------------------------------------------------------------------------------------------
async function continueRun(deps: Deps, feed: FeedRow, runId: number, cp: Checkpoint, deadline: number): Promise<StepResult> {
  const db = deps.env.DB;
  const today = pragueToday(deps.now());
  const run: RunCtx = { runId, nowSql: sqlTime(deps.now()), today, lmDays: lmDays(deps), firstMinuteDays: fmDays(deps) };

  while (cp.phase === 'apply' && cp.next < cp.blocks) {
    const cur = await db.prepare('SELECT current_run FROM feeds WHERE id = ?').bind(feed.id).first<{ current_run: number | null }>();
    if (cur?.current_run !== runId) return { feedId: feed.id, runId, status: 'superseded', message: 'run is no longer the current run of the feed' };
    // an older run must never overwrite data written by a newer successful run
    if (feed.last_success_run && runId < feed.last_success_run) {
      await saveRun(deps, runId, { status: 'aborted', finished_at: sqlTime(deps.now()), message: 'stale run: a newer run already finished' });
      await db.prepare('UPDATE feeds SET current_run = NULL WHERE id = ?').bind(feed.id).run();
      return { feedId: feed.id, runId, status: 'superseded', message: 'stale run' };
    }
    const records = await readBlock(deps.env.SNAPSHOTS, feed.id, runId, cp.next);
    const hs = records.filter((r): r is Extract<BlockRecord, { k: 'h' }> => r.k === 'h');
    const ps = records.filter((r): r is Extract<BlockRecord, { k: 'p' }> => r.k === 'p');
    if (hs.length) {
      const up = await upsertHotels(db, hs.map((r) => r.hotel), feed.partner_slug, run.nowSql);
      const items = hs.flatMap((r, i) => r.offers.map((offer) => ({ hotelId: up.ids[i]!, offer })));
      const st = await applyOffers(db, feed, items, run);
      cp.counters.created += st.created; cp.counters.changed += st.changed; cp.counters.unchanged += st.unchanged + st.duplicates; cp.counters.stale += st.stale;
      cp.counters.hotelsCreated += up.created; cp.counters.rows += st.created + st.changed + up.created + up.enriched;
    }
    if (ps.length) {
      const st = await applyProducts(db, feed, ps.map((r) => r.product), run);
      cp.counters.created += st.created; cp.counters.changed += st.changed; cp.counters.unchanged += st.unchanged + st.duplicates; cp.counters.stale += st.stale; cp.counters.rows += st.created + st.changed;
    }
    cp.next++;
    await saveRun(deps, runId, { checkpoint_json: JSON.stringify(cp), ...counterPatch(cp.counters) });
    await extendLock(deps, feed.id);
    if (Date.now() > deadline && cp.next < cp.blocks) return { feedId: feed.id, runId, status: 'continue', message: `applied ${cp.next}/${cp.blocks} blocks` };
  }
  if (cp.phase === 'apply') { cp.phase = 'finalize'; await saveRun(deps, runId, { checkpoint_json: JSON.stringify(cp) }); }

  // finalize ------------------------------------------------------------------------------------------------
  const manifest = await readManifest(deps.env.SNAPSHOTS, feed.id, runId);
  let hold: string | undefined;
  const table = feed.content_type === 'products' ? 'products' : 'offers';
  if (feed.is_full_catalogue) {
    const active = (await db.prepare(`SELECT id, external_id${table === 'offers' ? ', hotel_id' : ''} FROM ${table} WHERE feed_id = ? AND active = 1`).bind(feed.id).all<{ id: number; external_id: string; hotel_id?: number }>()).results;
    const present = new Set(manifest.present);
    const missing = active.filter((r) => !present.has(r.external_id));
    const limit = Math.max(50, Math.floor(active.length * 0.35));
    if (!rotatingIds(feed) && missing.length > limit) hold = `suspicious: ${missing.length} of ${active.length} active ${table} are missing from the feed (limit ${limit}); nothing was deactivated`;
    else if (missing.length) {
      const stmts = chunk(missing.map((m) => m.id), MAX_PARAMS).map((ids) => db.prepare(`UPDATE ${table} SET active = 0 WHERE active = 1 AND id IN (${qs(ids.length)})`).bind(...ids));
      cp.counters.deactivated += await runBatches(db, stmts);
      cp.counters.rows += cp.counters.deactivated;
    }
  } // incremental feeds: a missing item is never interpreted as deleted

  if (table === 'offers') {
    const hotelIds = (await db.prepare('SELECT DISTINCT hotel_id FROM offers WHERE feed_id = ?').bind(feed.id).all<{ hotel_id: number }>()).results.map((r) => r.hotel_id);
    const ag = await recomputeAggregates(db, hotelIds, { today, nowSql: run.nowSql });
    cp.counters.rows += ag.written;
  }

  const finished = sqlTime(deps.now());
  const win = parseWindow(deps.env.IMPORT_WINDOW);
  if (hold) {
    await saveRun(deps, runId, { status: 'suspicious', finished_at: finished, duration_ms: Date.now() - cp.startedMs, message: hold, checkpoint_json: JSON.stringify(cp), ...counterPatch(cp.counters) });
    await db.prepare('UPDATE feeds SET current_run = NULL, force_run = 0, next_run_at = ? WHERE id = ?').bind(nextRunAt(deps.now(), feed.interval_hours, win), feed.id).run();
    return { feedId: feed.id, runId, status: 'suspicious', message: hold };
  }
  await saveRun(deps, runId, { status: 'ok', finished_at: finished, duration_ms: Date.now() - cp.startedMs, checkpoint_json: JSON.stringify(cp), message: `ok (${JSON.stringify(cp.rejectedByReason ?? {})})`, ...counterPatch(cp.counters) });
  await db.prepare('UPDATE feeds SET current_run = NULL, force_run = 0, last_success_run = ?, last_success_at = ?, last_success_count = ?, etag = ?, last_modified = ?, next_run_at = ? WHERE id = ?')
    .bind(runId, finished, cp.counters.accepted, cp.etag, cp.lastModified, nextRunAt(deps.now(), feed.interval_hours, win), feed.id).run();
  // retention: keep this run and the previous good one restorable, drop older snapshots
  await pruneSnapshots(deps.env.SNAPSHOTS, feed.id, [runId, feed.last_success_run ?? -1]);
  return { feedId: feed.id, runId, status: 'ok' };
}

/** Admin approval of a held run: apply its already stored blocks (the manifest and blocks are still in R2). */
export async function approveRun(deps: Deps, feedId: number, deadline: number): Promise<StepResult> {
  const db = deps.env.DB;
  const feed = await loadFeed(deps, feedId);
  if (!feed) return { feedId, runId: null, status: 'skipped', message: 'unknown feed' };
  const run = await db.prepare("SELECT id, checkpoint_json FROM import_runs WHERE feed_id = ? AND status = 'suspicious' ORDER BY id DESC LIMIT 1").bind(feedId).first<{ id: number; checkpoint_json: string | null }>();
  if (!run?.checkpoint_json) return { feedId, runId: null, status: 'skipped', message: 'no suspicious run to approve' };
  const cp = JSON.parse(run.checkpoint_json) as Checkpoint;
  if (cp.phase === 'held') { cp.phase = 'apply'; cp.hold = undefined; }
  else if (cp.phase === 'finalize') cp.hold = 'approved';
  // finalize-held runs re-run the deactivation without the ratio guard through a one-off flag in the checkpoint
  await saveRun(deps, run.id, { status: 'running', finished_at: null, message: 'approved manually', checkpoint_json: JSON.stringify(cp) });
  await db.prepare('UPDATE feeds SET current_run = ?, force_run = 0 WHERE id = ?').bind(run.id, feedId).run();
  return stepFeed(deps, feedId, deadline);
}
