// Small helpers: isolate memo (seconds) and Cache API JSON cache (when running on Workers).
const memo = new Map<string, { at: number; v: unknown }>();

export async function memoized<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlSec * 1000) return hit.v as T;
  const v = await fn();
  if (memo.size > 500) memo.clear();
  memo.set(key, { at: Date.now(), v });
  return v;
}

/** JSON in the colo-local Cache API (not shared across colos); falls back to plain compute without `caches`. */
export async function cachedJson<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  if (!c) return fn();
  const req = new Request('https://cache.kakapo.internal/' + encodeURIComponent(key));
  try {
    const hit = await c.match(req);
    if (hit) return (await hit.json()) as T;
  } catch { /* ignore */ }
  const v = await fn();
  try { await c.put(req, new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttlSec}` } })); } catch { /* ignore */ }
  return v;
}
export const clearMemo = () => memo.clear();

/** Durable JSON cache in D1 `site_cache` (shared by all colos/isolates). Heavy per-landing blocks (48 topic counts) are computed once per TTL. */
export async function storedJson<T>(db: D1Database, key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  try {
    const row = await db.prepare('SELECT value, updated_at FROM site_cache WHERE key = ?').bind(key).first<{ value: string; updated_at: string }>();
    if (row && Date.now() - Date.parse(row.updated_at) < ttlSec * 1000) return JSON.parse(row.value) as T;
  } catch { /* table missing in tests → compute */ }
  const v = await fn();
  try { const now = new Date().toISOString(); await db.prepare('INSERT INTO site_cache (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').bind(key, JSON.stringify(v), now).run(); } catch { /* ignore */ }
  return v;
}
