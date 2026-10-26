import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

/** Minimal D1Database over node:sqlite (prepare/bind/all/first) with the real 0001 migration applied. */
export function makeD1(): { db: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(new URL('../../migrations/0001_init.sql', import.meta.url), 'utf8'));
  const prep = (sql: string, params: unknown[] = []) => ({
    bind: (...p: unknown[]) => prep(sql, p),
    all: async <T>() => ({ results: raw.prepare(sql).all(...(params as any[])) as T[], success: true, meta: {} }),
    first: async <T>() => ((raw.prepare(sql).get(...(params as any[])) as T | undefined) ?? null),
    run: async () => { raw.prepare(sql).run(...(params as any[])); return { success: true, meta: {} }; },
  });
  return { db: { prepare: (sql: string) => prep(sql) } as unknown as D1Database, raw };
}

export interface HotelSeed { id: number; slug: string; name: string; [k: string]: unknown }
export function addHotel(raw: DatabaseSync, h: HotelSeed): void {
  const row: Record<string, unknown> = {
    dedup_key: `k|${h.slug}`, country: 'Řecko', country_slug: 'recko', destination: 'Kréta', destination_slug: 'kreta', city: 'Amoudara', city_slug: 'amoudara',
    stars: 4, description: '', images_json: '[]', amenities_json: '[]', offers_active: 0, created_at: '2026-07-05 10:10:21', updated_at: '2026-10-20 08:00:00', ...h,
  };
  const cols = Object.keys(row);
  raw.prepare(`INSERT INTO hotels (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...(Object.values(row) as any[]));
}
let oid = 100;
export function addOffer(raw: DatabaseSync, hotelId: number, o: Record<string, unknown> = {}): number {
  const id = oid++;
  const row: Record<string, unknown> = {
    id, hotel_id: hotelId, feed_id: 1, partner_slug: 'fischer', external_id: `e${id}`, content_hash: 'h', price_pp: 20000, departure_date: '2026-12-01', return_date: '2026-12-08',
    nights: 7, days: 8, meal_type: 'all-inclusive', airport: 'Praha', airport_slug: 'praha', room_type: 'Dvoulůžkový', affiliate_url: 'https://www.kqzyfj.com/click-1-2?url=x', active: 1,
    last_seen: '2026-10-26 01:00:00', created_at: '2026-10-01 01:00:00', updated_at: '2026-10-26 01:00:00', ...o,
  };
  const cols = Object.keys(row);
  raw.prepare(`INSERT INTO offers (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...(Object.values(row) as any[]));
  return id;
}
export function baseSeed(raw: DatabaseSync): void {
  raw.exec(`INSERT INTO partners (slug,name) VALUES ('fischer','Fischer'),('invia','Invia'),('cedok','Čedok')`);
  raw.exec(`INSERT INTO feeds (id,name,partner_slug,adapter,content_type,source_ref) VALUES (1,'Fischer','fischer','cj-atcom','hotels','FEED_URL_1'),(2,'Invia','invia','xml-invia_hotels','hotels','FEED_URL_2'),(3,'Čedok','cedok','cedok-slim','hotels','FEED_URL_3')`);
}
