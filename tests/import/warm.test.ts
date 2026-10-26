import { describe, expect, it } from 'vitest';
import { makeHarness } from './helpers';
import { warmImages } from '../../workers/import/src/engine/warm';
import { warmUrlsForHotel, warmUrlsForProduct } from '../../src/lib/images';
import { imgUrl } from '../../src/lib/helpers';
import { srcsetRaw } from '../../src/lib/listing/html';

const IMG: [string, string, string] = ['https://img.partner.test/a.jpg', 'https://img.partner.test/b.jpg', 'https://img.partner.test/c.jpg'];

function seedHotel(h: ReturnType<typeof makeHarness>, id: number, images: string[], active = 3) {
  h.raw.prepare(`INSERT INTO hotels (id, slug, dedup_key, name, images_json, offers_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '2026-10-26', '2026-10-26')`)
    .run(id, `h-${id}`, `k-${id}`, `Hotel ${id}`, JSON.stringify(images), active);
}

describe('image warm URLs match what the templates render', () => {
  it('hotel: card 1x/2x, hero 1280/78 and grid photos 2–5', () => {
    const urls = warmUrlsForHotel(IMG);
    const card1x = imgUrl(IMG[0], 640); const card2x = srcsetRaw(IMG[0], 640).split(', ')[1]!.replace(/ 2x$/, '');
    expect(urls).toContain(card1x); expect(urls).toContain(card2x);
    expect(urls).toContain(imgUrl(IMG[0], 1280, 78));
    expect(urls).toContain(imgUrl(IMG[1], 640, 72)); expect(urls).toContain(imgUrl(IMG[2], 640, 72));
    expect(new Set(urls).size).toBe(urls.length);
  });
  it('product: card image_url falls back to the first gallery photo', () => {
    expect(warmUrlsForProduct('', IMG)[0]).toBe(imgUrl(IMG[0], 640, 72));
    expect(warmUrlsForProduct('https://img.partner.test/card.jpg', IMG)).toContain(imgUrl(IMG[0], 1280, 78));
  });
});

describe('warmImages', () => {
  it('fetches every URL once, marks the hotel, and skips it next time', async () => {
    const h = makeHarness(); seedHotel(h, 1, IMG);
    h.routes.set('wsrv.nl/', () => new Response(new Uint8Array(10), { status: 200 }));
    const r = await warmImages(h.deps);
    expect(r.items).toBe(1); expect(r.requests).toBe(warmUrlsForHotel(IMG).length);
    expect((h.raw.prepare('SELECT img_warm FROM hotels WHERE id = 1').get() as { img_warm: string }).img_warm).toBe(IMG[0]);
    expect((await warmImages(h.deps)).requests).toBe(0);
  });
  it('a failing image is not marked and is retried next tick; 429 stops the tick', async () => {
    const h = makeHarness(); seedHotel(h, 1, IMG); seedHotel(h, 2, ['https://img.partner.test/z.jpg']);
    let n = 0;
    h.routes.set('wsrv.nl/', () => (++n === 1 ? new Response('busy', { status: 429 }) : new Response('x')));
    const r = await warmImages(h.deps);
    expect(r.rateLimited).toBe(true);
    expect(h.raw.prepare('SELECT COUNT(*) AS n FROM hotels WHERE img_warm IS NOT NULL').get()).toEqual({ n: 0 });
    expect((await warmImages(h.deps)).items).toBe(2);
  });
  it('respects the per-tick budget and new first photo re-warms', async () => {
    const h = makeHarness(); for (let i = 1; i <= 10; i++) seedHotel(h, i, IMG);
    h.routes.set('wsrv.nl/', () => new Response('x'));
    const per = warmUrlsForHotel(IMG).length;
    expect((await warmImages(h.deps, per * 3)).items).toBe(3);
    h.raw.prepare('UPDATE hotels SET images_json = ? WHERE id = 1').run(JSON.stringify(['https://img.partner.test/new.jpg']));
    await warmImages(h.deps, 10_000);
    expect((h.raw.prepare('SELECT img_warm FROM hotels WHERE id = 1').get() as { img_warm: string }).img_warm).toBe('https://img.partner.test/new.jpg');
  });
});
