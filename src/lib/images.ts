// Exactly the image URLs the templates render (built with the same imgUrl()), so the import Worker can pre-warm the
// wsrv.nl cache: an image fetched once is served from its cache (~0.1 s), a never-requested one takes up to ~7 s.
import { imgUrl } from './helpers';

const clean = (u: unknown) => String(u ?? '').trim();
const uniq = (a: string[]) => [...new Set(a.filter((u) => /^https:\/\/wsrv\.nl\//.test(u)))];

/** Hotel: card (640/72 + 2x 1280/72), hotel hero (1280/78), gallery grid photos 2–5 (640/72). */
export function warmUrlsForHotel(images: unknown[]): string[] {
  const list = images.map(clean).filter(Boolean);
  const first = list[0];
  if (!first) return [];
  return uniq([imgUrl(first, 640, 72), imgUrl(first, 1280, 72), imgUrl(first, 1280, 78), ...list.slice(1, 5).map((u) => imgUrl(u, 640, 72))]);
}

/** Product: card image (image_url or first gallery photo, 640/72 + 2x) and the detail hero (first gallery photo, 1280/78). */
export function warmUrlsForProduct(imageUrl: unknown, images: unknown[]): string[] {
  const list = images.map(clean).filter(Boolean);
  const card = clean(imageUrl) || list[0];
  const hero = list[0] || card;
  if (!card) return [];
  return uniq([imgUrl(card, 640, 72), imgUrl(card, 1280, 72), ...(hero ? [imgUrl(hero, 1280, 78)] : [])]);
}
