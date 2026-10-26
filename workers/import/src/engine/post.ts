// After a successful import run: refresh the registry/facet snapshots (also bumps data_version, i.e. the web edge cache)
// and rebuild the sitemaps at most once per SITEMAP_MIN_AGE_MS. Failures are logged and never fail the import.
import type { Deps } from '../deps';
import { rebuildSnapshots } from '../../../../src/lib/snapshots';
import { rebuildSitemaps } from '../../../../src/lib/sitemap';

export const SITEMAP_MIN_AGE_MS = 20 * 3600_000;

export async function afterRun(deps: Deps): Promise<{ snapshots: boolean; sitemaps: boolean }> {
  const db = deps.env.DB;
  const out = { snapshots: false, sitemaps: false };
  try {
    await (deps.hooks?.rebuildSnapshots ?? ((d, n) => rebuildSnapshots(d, n)))(db, deps.now().toISOString());
    out.snapshots = true;
  } catch (e) { deps.log('post.snapshots_failed', { error: e instanceof Error ? e.message : 'error' }); }
  try {
    const row = await db.prepare("SELECT updated_at FROM site_cache WHERE key = 'sitemap:index'").first<{ updated_at: string }>();
    const age = row ? deps.now().getTime() - Date.parse(row.updated_at) : Infinity;
    if (age >= SITEMAP_MIN_AGE_MS || Number.isNaN(age)) {
      await (deps.hooks?.rebuildSitemaps ?? ((d, b) => rebuildSitemaps(d, b)))(db, (deps.env.SITE_URL ?? 'https://kakapo.cz').replace(/\/$/, ''));
      out.sitemaps = true;
    }
  } catch (e) { deps.log('post.sitemaps_failed', { error: e instanceof Error ? e.message : 'error' }); }
  return out;
}

/** Snapshots/data_version are refreshed at most once per SNAPSHOT_MIN_AGE_MS: every refresh changes all web edge-cache keys,
 *  so per-feed refreshes (40 feeds) used to keep the page cache permanently cold. Runs only mark the data dirty. */
export const SNAPSHOT_MIN_AGE_MS = 20 * 60_000;

export async function markDirty(deps: Deps, rowsWritten: number): Promise<void> {
  if (rowsWritten <= 0) return;
  try {
    await deps.env.DB.prepare("INSERT INTO site_cache (key,value,updated_at) VALUES ('snapshots_dirty','1',?) ON CONFLICT(key) DO UPDATE SET value='1', updated_at=excluded.updated_at").bind(deps.now().toISOString()).run();
  } catch (e) { deps.log('post.mark_dirty_failed', { error: e instanceof Error ? e.message : 'error' }); }
}

/** End of a cron tick: rebuild snapshots (+ sitemaps when old) if something changed and the last rebuild is old enough. */
export async function afterTick(deps: Deps): Promise<boolean> {
  const db = deps.env.DB;
  try {
    const dirty = await db.prepare("SELECT value FROM site_cache WHERE key = 'snapshots_dirty'").first<{ value: string }>();
    if (!dirty || dirty.value !== '1') return false;
    const reg = await db.prepare("SELECT updated_at FROM site_cache WHERE key = 'registry'").first<{ updated_at: string }>();
    const age = reg ? deps.now().getTime() - Date.parse(reg.updated_at) : Infinity;
    if (age < SNAPSHOT_MIN_AGE_MS) return false;
    await afterRun(deps);
    await db.prepare("UPDATE site_cache SET value = '0' WHERE key = 'snapshots_dirty'").run();
    return true;
  } catch (e) { deps.log('post.after_tick_failed', { error: e instanceof Error ? e.message : 'error' }); return false; }
}
