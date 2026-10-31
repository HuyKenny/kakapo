// data_version: bumped by the import Worker after every run (site_cache key). Part of every edge-cache key so a
// price change is visible right after an import, without purging.
import { getEnv } from './env';

let memo: { v: string; at: number } | null = null;
export async function dataVersion(): Promise<string> {
  if (memo && Date.now() - memo.at < 15_000) return memo.v;
  const row = await getEnv().DB.prepare("SELECT value FROM site_cache WHERE key='data_version'").first<{ value: string }>();
  memo = { v: row?.value ?? '0', at: Date.now() };
  return memo.v;
}
export const invalidateVersionMemo = () => { memo = null; };

/** Admin writes (hide, override, redirects, feeds) change what the public pages show; a new version drops the page and query caches at once. */
export async function bumpDataVersion(): Promise<void> {
  const now = new Date().toISOString();
  try { await getEnv().DB.prepare("INSERT INTO site_cache (key,value,updated_at) VALUES ('data_version',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").bind(now, now).run(); } catch { /* ignore */ }
  memo = null;
}
