// Hotel retirement (301 to the best live category), reactivation, and the feed parity check.
import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { makeDb, makeR2 } from './helpers';
import type { Db } from '../../workers/import/src/deps';
import { reactivateRetired, redirectTarget, retireHotels } from '../../workers/import/src/engine/lifecycle';
import { checkParity } from '../../workers/import/src/engine/parity';
import { blockKey } from '../../workers/import/src/engine/blocks';

const NOW = new Date('2026-10-27T03:00:00Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86400_000).toISOString().slice(0, 19).replace('T', ' ');
let raw: DatabaseSync; let db: Db; let nextId = 1;

function hotel(o: { slug?: string; country?: string; dest?: string; active?: number; seen?: string | null; created?: string; hidden?: number } = {}) {
  const id = nextId++; const slug = o.slug ?? `h-${id}`;
  raw.prepare(`INSERT INTO hotels (id, slug, dedup_key, name, country_slug, destination_slug, offers_active, offers_last_seen, hidden, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, slug, 'k-' + id, slug, o.country ?? 'recko', o.dest ?? '', o.active ?? 0, o.seen === undefined ? day(100) : o.seen, o.hidden ?? 0, o.created ?? day(200), day(1));
  return { id, slug };
}
const live = (n: number, country: string, dest = '') => { for (let i = 0; i < n; i++) hotel({ country, dest, active: 1, seen: day(0) }); };
const redirect = (slug: string) => raw.prepare('SELECT to_path, status, reason FROM redirects WHERE from_path = ?').get(`/hotel/${slug}/`) as { to_path: string; status: number; reason: string } | undefined;
const retiredAt = (id: number) => (raw.prepare('SELECT retired_at AS r FROM hotels WHERE id = ?').get(id) as { r: string | null }).r;

beforeEach(() => { ({ db, raw } = makeDb()); nextId = 1; raw.exec('PRAGMA foreign_keys = OFF'); });

describe('redirectTarget', () => {
  const dest = new Map([['recko/kreta', 40], ['cesko/praha', 3]]); const country = new Map([['recko', 120], ['cesko', 30], ['kypr', 4]]);
  it('prefers a populated destination, then the country, then the listing', () => {
    expect(redirectTarget({ country_slug: 'recko', destination_slug: 'kreta' }, dest, country)).toBe('/recko/kreta/');
    expect(redirectTarget({ country_slug: 'recko', destination_slug: 'rhodos' }, dest, country)).toBe('/recko/');
    expect(redirectTarget({ country_slug: 'cesko', destination_slug: 'praha' }, dest, country)).toBe('/cesko/'); // 3 hotels is too thin for a destination page
    expect(redirectTarget({ country_slug: 'kypr', destination_slug: '' }, dest, country)).toBe('/zajezdy/');
    expect(redirectTarget({ country_slug: '', destination_slug: '' }, dest, country)).toBe('/zajezdy/');
  });
  it('maps alias countries to the canonical one', () => {
    expect(redirectTarget({ country_slug: 'ceska-republika', destination_slug: '' }, dest, country)).toBe('/cesko/');
  });
});

describe('retireHotels', () => {
  it('retires only hotels without offers for 60+ days and points them at live categories', async () => {
    live(15, 'recko', 'kreta'); live(14, 'recko', 'korfu');
    const old = hotel({ country: 'recko', dest: 'kreta' });            // 100 days dead → destination
    const oldOther = hotel({ country: 'recko', dest: 'rhodos' });      // destination too thin → country
    const never = hotel({ country: 'italie', seen: null, created: day(90) }); // never live, created 90 days ago → listing
    const recent = hotel({ country: 'recko', dest: 'kreta', seen: day(20) });  // only 20 days → stays
    const liveOne = hotel({ country: 'recko', dest: 'kreta', active: 1, seen: day(0) });
    const hidden = hotel({ hidden: 1 });
    const r = await retireHotels(db, { now: NOW });
    expect(r.retired).toBe(3);
    expect(redirect(old.slug)).toEqual({ to_path: '/recko/kreta/', status: 301, reason: 'retired' });
    expect(redirect(oldOther.slug)?.to_path).toBe('/recko/');
    expect(redirect(never.slug)?.to_path).toBe('/zajezdy/');
    for (const h of [recent, liveOne, hidden]) { expect(redirect(h.slug)).toBeUndefined(); expect(retiredAt(h.id)).toBeNull(); }
    expect(retiredAt(old.id)).not.toBeNull();
    expect(r.byTarget).toEqual({ destination: 1, country: 1, '/zajezdy/': 1 });
  });
  it('is idempotent and a dry run writes nothing', async () => {
    live(15, 'recko');
    const h = hotel();
    const dry = await retireHotels(db, { now: NOW, dry: true });
    expect(dry.candidates).toBe(1); expect(dry.retired).toBe(0); expect(redirect(h.slug)).toBeUndefined();
    expect((await retireHotels(db, { now: NOW })).retired).toBe(1);
    expect((await retireHotels(db, { now: NOW })).retired).toBe(0);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM redirects WHERE reason = 'retired'").get() as { n: number }).n).toBe(1);
  });
  it('never overwrites a manual or merge redirect, and respects the limit', async () => {
    live(15, 'recko');
    const a = hotel(); hotel(); hotel();
    raw.prepare("INSERT INTO redirects (from_path, to_path, status, reason, created_at) VALUES (?, '/hotel/jiny/', 301, 'merge', ?)").run(`/hotel/${a.slug}/`, day(1));
    expect((await retireHotels(db, { now: NOW, limit: 2 })).retired).toBe(2);
    expect(redirect(a.slug)).toMatchObject({ to_path: '/hotel/jiny/', reason: 'merge' });
  });
});

describe('reactivateRetired', () => {
  it('removes the redirect and the flag when an offer is back, and leaves other redirects alone', async () => {
    live(15, 'recko');
    const back = hotel(); const still = hotel();
    await retireHotels(db, { now: NOW });
    raw.prepare("UPDATE hotels SET offers_active = 2 WHERE id = ?").run(back.id);
    raw.prepare("INSERT INTO redirects (from_path, to_path, status, reason, created_at) VALUES ('/hotel/rucni/', '/zajezdy/', 301, 'manual', ?)").run(day(1));
    expect(await reactivateRetired(db, [back.id, still.id])).toBe(1);
    expect(redirect(back.slug)).toBeUndefined(); expect(retiredAt(back.id)).toBeNull();
    expect(redirect(still.slug)).toBeDefined(); expect(retiredAt(still.id)).not.toBeNull();
    expect(raw.prepare("SELECT 1 FROM redirects WHERE from_path = '/hotel/rucni/'").get()).toBeDefined();
    raw.prepare("UPDATE hotels SET offers_active = 1 WHERE id = ?").run(still.id);
    expect(await reactivateRetired(db)).toBe(1); // the daily job checks all
  });
});

describe('checkParity', () => {
  const offer = (id: string, price: number) => ({ external_id: id, price_pp: price, departure_date: '2026-12-01', nights: 7 });
  async function seed(rows: Array<{ id: string; price: number; active?: number }>, blockOffers: ReturnType<typeof offer>[], feedId = 1) {
    const r2 = makeR2();
    const hid = hotel({ active: 1, seen: day(0) }).id;
    for (const x of rows) raw.prepare(`INSERT INTO offers (hotel_id, feed_id, partner_slug, external_id, content_hash, price_pp, departure_date, nights, affiliate_url, active, last_seen, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(hid, feedId, 'fischer', x.id, 'h', x.price, '2026-12-01', 7, 'https://x.test/', x.active ?? 1, day(0), day(0), day(0));
    await r2.put(blockKey(feedId, 5, 0), blockOffers.length ? JSON.stringify({ k: 'h', hotel: {}, offers: blockOffers }) + '\n' : '');
    return r2;
  }
  const ids = (n: number, price = 1000) => Array.from({ length: n }, (_, i) => ({ id: `o${i}`, price }));
  it('is clean when the database matches the feed', async () => {
    const r2 = await seed(ids(50), ids(50).map((x) => offer(x.id, x.price)));
    const p = await checkParity(db, r2, { id: 1 }, 5, 1, 50, 0);
    expect(p).toMatchObject({ present: 50, activeAfter: 50, sampled: 50, mismatched: 0, warn: false });
  });
  it('flags changed prices, stale-active rows and missing items', async () => {
    const r2 = await seed(ids(50), ids(50).map((x, i) => offer(x.id, i < 10 ? 2000 : x.price)));
    const priceDiff = await checkParity(db, r2, { id: 1 }, 5, 1, 50, 0);
    expect(priceDiff.warn).toBe(true); expect(priceDiff.mismatched).toBe(10); expect(priceDiff.note).toContain('10/50');
    const stale = await checkParity(db, r2, { id: 1 }, 5, 1, 30, 0); // 50 active, feed only has 30 → 20 survived deactivation
    expect(stale.note).toContain('20 active offers are not in the feed');
    const missing = await checkParity(db, r2, { id: 1 }, 5, 1, 200, 0); // feed has 200 items, only 50 active, none rejected
    expect(missing.note).toContain('150 feed items have no active offer');
    expect((await checkParity(db, r2, { id: 1 }, 5, 1, 200, 150)).note).not.toContain('no active offer'); // rejected items explain the gap
  });
});
