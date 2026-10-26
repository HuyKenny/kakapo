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
