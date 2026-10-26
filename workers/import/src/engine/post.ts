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
