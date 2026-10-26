import { afterTick } from './post';
import { warmImages } from './warm';
import type { Deps } from '../deps';
import { sqlTime } from '../util/text';
import { stepFeed, type StepResult } from './run';
import { parseWindow, windowOpen } from './schedule';

/** Cron tick: resume running imports first, then start feeds that are due (night window unless a manual run is queued). */
export async function runTick(deps: Deps): Promise<StepResult[]> {
  const db = deps.env.DB;
  const deadline = Date.now() + deps.budgetMs;
  const results: StepResult[] = [];
  const nowSql = sqlTime(deps.now());
  const open = windowOpen(deps.now(), parseWindow(deps.env.IMPORT_WINDOW));

  const running = (await db.prepare('SELECT id FROM feeds WHERE enabled = 1 AND paused = 0 AND current_run IS NOT NULL ORDER BY id').all<{ id: number }>()).results;
  const due = (await db.prepare(`SELECT id FROM feeds WHERE enabled = 1 AND paused = 0 AND current_run IS NULL
    AND (force_run = 1 OR (? = 1 AND (next_run_at IS NULL OR next_run_at <= ?))) ORDER BY force_run DESC, next_run_at ASC`).bind(open ? 1 : 0, nowSql).all<{ id: number }>()).results;

  for (const { id } of [...running, ...due]) {
    while (Date.now() < deadline) {
      const r = await stepFeed(deps, id, deadline);
      results.push(r);
      if (r.status !== 'continue') break;
    }
    if (Date.now() >= deadline) break;
  }
  await afterTick(deps);
  // image cache warming only when no import is busy with this invocation's budget
  if (Date.now() < deadline - 120_000) await warmImages(deps).catch((e) => deps.log('warm.failed', { error: e instanceof Error ? e.message : 'error' }));
  return results;
}
