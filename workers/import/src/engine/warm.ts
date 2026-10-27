// Pre-warm the wsrv.nl image cache for photos the site shows above the fold (src/lib/images.ts builds the exact URLs).
// Budgeted per cron tick (subrequest limit, politeness towards a free service); progress is stored in img_warm.
import type { Deps } from '../deps';
import { jsonArr } from '../../../../src/lib/helpers';
import { warmUrlsForHotel, warmUrlsForProduct } from '../../../../src/lib/images';

export const WARM_BUDGET = 700;      // image requests per tick
const CONCURRENCY = 6;
const TIMEOUT_MS = 25_000;
const UA = 'KakapoImageWarmer/1.0 (+https://kakapo.cz)';

interface Item { table: 'hotels' | 'products'; id: number; key: string; urls: string[]; imgs?: string[]; dead?: Set<string> }

/** warmUrlsForHotel() order: first photo ×3 variants, then photos 2–5 → the source photo a URL index belongs to. */
const hotelPhotoOf = (i: number) => (i < 3 ? 0 : i - 2);

export async function warmImages(deps: Deps, budget = WARM_BUDGET): Promise<{ items: number; requests: number; failed: number; pruned: number; rateLimited: boolean; statuses: Record<string, number> }> {
  const db = deps.env.DB;
  const items: Item[] = [];
  let planned = 0;
  const hotels = (await db.prepare(`SELECT id, images_json FROM hotels WHERE offers_active > 0 AND hidden = 0 AND images_json IS NOT NULL AND images_json NOT IN ('', '[]')
      AND (img_warm IS NULL OR img_warm <> json_extract(images_json, '$[0]')) ORDER BY offers_active DESC, id LIMIT 200`).all<{ id: number; images_json: string }>()).results;
  for (const h of hotels) {
    const imgs = jsonArr<string>(h.images_json); const urls = warmUrlsForHotel(imgs);
    if (!urls.length || planned + urls.length > budget) continue;
    items.push({ table: 'hotels', id: h.id, key: String(imgs[0]), urls, imgs }); planned += urls.length;
  }
  if (planned < budget) {
    const products = (await db.prepare(`SELECT id, image_url, images_json FROM products WHERE active = 1 AND hidden = 0
        AND (img_warm IS NULL OR img_warm <> COALESCE(NULLIF(image_url, ''), json_extract(images_json, '$[0]'))) ORDER BY id LIMIT 200`).all<{ id: number; image_url: string | null; images_json: string | null }>()).results;
    for (const p of products) {
      const imgs = jsonArr<string>(p.images_json); const urls = warmUrlsForProduct(p.image_url, imgs);
      if (!urls.length || planned + urls.length > budget) continue;
      items.push({ table: 'products', id: p.id, key: String(p.image_url || imgs[0]), urls }); planned += urls.length;
    }
  }

  let requests = 0, failed = 0, rateLimited = false;
  const statuses: Record<string, number> = {};
  const done: Item[] = [];
  const queue = [...items];
  const worker = async () => {
    for (let it = queue.shift(); it && !rateLimited; it = queue.shift()) {
      let ok = true;
      for (const [ui, u] of it.urls.entries()) {
        if (rateLimited) { ok = false; break; }
        requests++;
        try {
          const res = await deps.fetch(u, { headers: { 'User-Agent': UA, Accept: 'image/webp,image/*' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
          statuses[res.status] = (statuses[res.status] ?? 0) + 1;
          await res.arrayBuffer().catch(() => undefined); // drain the body so the image is fully produced and cached
          if (res.status === 429) { rateLimited = true; ok = false; break; }
          if (res.status === 404 || res.status === 410) {
            // the partner's photo is gone (≈1 in 5 feed hotels): remember it so it is dropped below instead of being retried forever
            if (it.imgs) (it.dead ??= new Set()).add(String(it.imgs[hotelPhotoOf(ui)]));
            ok = false;
          } else if (!res.ok) ok = false; // transient (5xx/timeout): retried next tick, never blocks others
        } catch (e) { ok = false; const k = 'err:' + (e instanceof Error ? e.name : 'x'); statuses[k] = (statuses[k] ?? 0) + 1; }
      }
      if (ok) done.push(it); else failed++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  // dead photos leave images_json, so the next photo becomes the first one (cards/hero show it, the warmer moves on)
  const pruned = items.filter((it) => it.dead && it.imgs);
  for (let i = 0; i < pruned.length; i += 50) {
    await db.batch(pruned.slice(i, i + 50).map((it) => db.prepare('UPDATE hotels SET images_json = ? WHERE id = ?').bind(JSON.stringify(it.imgs!.filter((u) => !it.dead!.has(String(u)))), it.id)));
  }
  for (let i = 0; i < done.length; i += 50) {
    await db.batch(done.slice(i, i + 50).map((d) => db.prepare(`UPDATE ${d.table} SET img_warm = ? WHERE id = ?`).bind(d.key, d.id)));
  }
  deps.log('warm.done', { items: done.length, requests, failed, pruned: pruned.length, rateLimited, statuses });
  return { items: done.length, requests, failed, pruned: pruned.length, rateLimited, statuses };
}
