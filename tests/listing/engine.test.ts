// The static-site engine (src/lib/listing/engine.ts over the shards of static-data.ts) must list the same hotels, in the
// same order and with the same card price as the SSR search (src/lib/search.ts) it replaces.
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, describe, expect, it } from 'vitest';
import { memoryDb, wrap } from '../landing/d1';
import { normalizeFilters, search as ssrSearch, todayPrague, type Filters } from '../../src/lib/search';
import { buildIndex, buildShard } from '../../src/lib/listing/static-data';
import { decodeShard, mergeParams, renderCard, search, shardsFor, type Hotel } from '../../src/lib/listing/engine';
import { cardModel } from '../../src/lib/listing/html';

const TODAY = todayPrague();
const day = (n: number) => new Date(Date.parse(TODAY + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

async function loadAll(db: D1Database): Promise<{ hotels: Hotel[]; stale: boolean; index: Awaited<ReturnType<typeof buildIndex>> }> {
  const index = await buildIndex(db, TODAY);
  const hotels: Hotel[] = [];
  for (const [name] of index.shards) hotels.push(...decodeShard(JSON.parse(JSON.stringify(await buildShard(db, name, TODAY)))));
  return { hotels, stale: index.stale, index };
}

async function compare(db: D1Database, all: Hotel[], stale: boolean, input: Record<string, unknown>) {
  const f: Filters = normalizeFilters(input);
  const want = await ssrSearch(db, f, TODAY);
  const got = search(all, f, TODAY, stale);
  expect(got.total, JSON.stringify(input)).toBe(want.total);
  expect(got.items.map((x) => x.hotel.id), JSON.stringify(input)).toEqual(want.hotels.map((h) => h.id));
  expect(got.items.map((x) => x.best?.price ?? null), JSON.stringify(input)).toEqual(want.hotels.map((h) => (h.best_offer ? Number(h.best_offer.price_pp) : null)));
  expect(got.items.map((x) => x.best?.dep ?? null), JSON.stringify(input)).toEqual(want.hotels.map((h) => h.best_offer?.departure_date ?? null));
}

const CASES: Array<Record<string, unknown>> = [
  {}, { sort: 'price' }, { sort: 'price-desc' }, { sort: 'rating' }, { sort: 'discount' }, { sort: 'drop' }, { page: 2 }, { page: 9 },
  { country: 'turecko' }, { country: 'turecko', meal: 'all-inclusive' }, { country: 'recko', dest: 'kreta' }, { country_exclude: 'cesko,slovensko' },
  { meal: 'all-inclusive,polopenze', sort: 'price' }, { airport: 'praha' }, { airport: 'praha,brno', meal: 'snidane' }, { stars: '4,5' },
  { rating_min: 8 }, { price_max: 15000 }, { price_min: 12000, price_max: 30000, meal: 'all-inclusive' }, { flag: 'last-minute' },
  { flag: 'first-minute', sort: 'price' }, { flag: 'zlevneno' }, { theme: 'sea' }, { theme: 'children' }, { date_from: day(20), date_to: day(60) }, { stay_night: day(30) }, { stay_night: day(30), date_from: day(20), date_to: day(30), sort: 'price' }, { stay_night: day(40), country: 'recko', sort: 'price' },
  { nights_min: 7, nights_max: 8 }, { adults: 2 }, { adults: 3 }, { transport: 'vlastni' }, { partner: 'fischer' }, { country: 'egypt', airport: 'praha', date_from: day(10), nights_min: 6, sort: 'price', page: 1 },
];

describe('static engine vs SSR search (fixture)', () => {
  let db: D1Database; let data: Awaited<ReturnType<typeof loadAll>>;
  beforeAll(async () => {
    const m = memoryDb(); db = m.db; const raw = m.raw;
    const now = '2026-11-20T10:00:00Z';
    raw.exec(`INSERT INTO partners (slug,name) VALUES ('fischer','Fischer'),('invia','Invia'),('cedok','Čedok')`);
    raw.exec(`INSERT INTO feeds (id,name,partner_slug,adapter,content_type,source_ref) VALUES (1,'F','fischer','cj-atcom','hotels','FEED_URL_1')`);
    const h = raw.prepare(`INSERT INTO hotels (id,slug,dedup_key,name,country,country_slug,destination,destination_slug,city_slug,stars,rating,images_json,min_price,price_drop_pct,offers_active,partners_count,has_last_minute,has_first_minute,has_all_inclusive,meal_flags,theme_flags,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const o = raw.prepare(`INSERT INTO offers (id,hotel_id,feed_id,partner_slug,external_id,content_hash,price_pp,price_original,departure_date,nights,meal_type,transport,airport,airport_slug,adults,is_last_minute,is_first_minute,affiliate_url,active,last_seen,created_at,updated_at) VALUES (?,?,1,?,?,'h',?,?,?,?,?,?,?,?,?,?,?,'https://x.test/a',?,?,?,?)`);
    const countries = [['Řecko', 'recko', ['Kréta', 'kreta'], ['Rhodos', 'rhodos']], ['Turecko', 'turecko', ['Antalya', 'antalya'], ['Alanya', 'alanya']], ['Egypt', 'egypt', ['Hurghada', 'hurghada'], ['Marsa Alam', 'marsa-alam']], ['Česko', 'cesko', ['Šumava', 'sumava'], ['Krkonoše', 'krkonose']]] as const;
    const meals = ['all-inclusive', 'polopenze', 'snidane', 'plna-penze', 'bez-stravy'];
    const ap = [['Praha', 'praha'], ['Brno', 'brno'], ['', '']];
    let rnd = 7; const r = (n: number) => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd % n; };
    let oid = 1;
    for (let i = 1; i <= 260; i++) {
      const c = countries[i % 4]!; const d = i % 3 ? c[2] : c[3];
      const offers: unknown[][] = [];
      for (let k = 0, nOff = r(5); k < nOff; k++) {
        const price = 8000 + r(30) * 1000 + (k % 2) * 500; const a = ap[r(3)]!;
        offers.push([oid++, i, ['fischer', 'invia', 'cedok'][r(3)], `e${oid}`, price, r(3) ? null : price + 3000, day(r(90) - 5), [4, 6, 7, 8, 10, 14][r(6)], meals[r(5)], r(4) ? 'letecky' : 'vlastni', a[0], a[1], r(5) ? 2 : 4, r(4) ? 0 : 1, r(5) ? 0 : 1, r(9) ? 1 : 0, now, now, now]);
      }
      const act = offers.filter((x) => x[15] === 1);
      const minP = act.length ? Math.min(...act.map((x) => Number(x[4]))) : 20000;
      const mf = act.reduce((m: number, x) => m | ({ 'all-inclusive': 1, polopenze: 2, snidane: 4, 'plna-penze': 8, 'bez-stravy': 16 } as Record<string, number>)[String(x[8])]!, 0);
      h.run(i, `hotel-${i}`, `k${i}`, i % 7 ? `Hotel ${i} ${d[0]}` : `Resort & Spa "${i}"`, c[0], c[1], d[0], d[1], i % 5 ? '' : d[1] + '-mesto', r(6), r(3) ? (50 + r(50)) / 10 : null,
        r(8) ? `["https://img.test/${i}.jpg"]` : (i % 2 ? '[]' : null), r(10) ? minP : minP, r(4) ? 0 : r(30), Math.max(1, act.length), 1 + r(4), act.some((x) => x[13]) ? 1 : 0, act.some((x) => x[14]) ? 1 : 0, mf & 1 ? 1 : 0, mf, r(8), now, now);
      for (const x of offers) o.run(...(x as never[]));
    }
    data = await loadAll(db);
  });

  it('every filter/sort/page combination matches', async () => {
    for (const c of CASES) await compare(db, data.hotels, data.stale, c);
  });

  it('stay_night keeps only stays that include that night (departure <= night < departure + nights)', () => {
    const night = day(30);
    const r = search(data.hotels, normalizeFilters({ stay_night: night, sort: 'departure' }), TODAY, data.stale);
    expect(r.total).toBeGreaterThan(0);
    const add = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
    for (const it of r.items) { expect(it.best!.dep <= night).toBe(true); expect(add(it.best!.dep, it.best!.nights) > night).toBe(true); }
    // a plain departure window is wider: some offers in it do not cover the night
    expect(search(data.hotels, normalizeFilters({ date_from: day(20), date_to: night }), TODAY, data.stale).total).toBeGreaterThanOrEqual(r.total);
  });

  it('merges landing filters with GET params like mergeFilters()', () => {
    const f = mergeParams({ country: 'recko', meal: ['all-inclusive'] }, { meal: 'snidane', bogus: '1' }, 3);
    expect(f.country).toBe('recko'); expect(f.meal).toEqual(['snidane']); expect(f.page).toBe(3);
    expect(shardsFor(normalizeFilters({ country: 'turecko' }), data.index)).toEqual(['turecko']);
    expect(shardsFor(normalizeFilters({ country_exclude: 'cesko' }), data.index)).not.toContain('cesko');
  });

  it('q matches name, destination and country without diacritics', () => {
    const ids = (q: string) => search(data.hotels, normalizeFilters({ q }), TODAY, data.stale).total;
    expect(ids('kreta')).toBe(data.hotels.filter((h) => h.destination === 'Kréta').length);
    expect(ids('Kréta')).toBe(ids('KRETA'));
    expect(ids('turecko')).toBe(data.hotels.filter((h) => h.country_slug === 'turecko').length);
    expect(ids('resort spa')).toBeGreaterThan(0);
  });

  it('card markup: same model as CardHotel.astro (cardModel)', async () => {
    const want = await ssrSearch(db, normalizeFilters({ meal: 'all-inclusive', sort: 'price' }), TODAY);
    const got = search(data.hotels, normalizeFilters({ meal: 'all-inclusive', sort: 'price' }), TODAY, data.stale);
    for (let i = 0; i < want.hotels.length; i++) {
      const row = want.hotels[i]!; const m = cardModel({ ...row, images: JSON.parse(row.images_json || '[]') }, '?meal=all-inclusive');
      const html = renderCard(got.items[i]!.hotel, got.items[i]!.best, '?meal=all-inclusive');
      expect(html).toContain(`href="${m.url}"`);
      if (m.bestBits) expect(html).toContain(`<p class="text-sm text-slate-500">${m.bestBits}</p>`);
      if (m.discount) expect(html).toContain(`−${m.discount} %`);
      expect(html.includes('badge-lm')).toBe(m.isLm);
      expect(html.includes('Porovnat')).toBe(m.partners > 1);
    }
    const odd = { ...data.hotels.find((h) => h.image)!, name: `Resort & Spa "Ö'"` };
    expect(renderCard(odd, null)).toContain('alt="Resort &amp; Spa &quot;Ö&#39;&quot;"');
  });
});

// Optional: the real state (data/state.db, pulled by scripts/static/state.sh; never in git).
const STATE = new URL('../../data/state.db', import.meta.url).pathname;
describe.skipIf(!existsSync(STATE))('static engine vs SSR search (data/state.db)', () => {
  it('matches on the real catalogue', async () => {
    const db = wrap(new DatabaseSync(STATE, { readOnly: true }));
    const data = await loadAll(db);
    for (const c of CASES) await compare(db, data.hotels, data.stale, c);
  }, 300_000);
});
