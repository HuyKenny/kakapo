// Daily maintenance (port of Kakapo_Import_Scheduler::daily + Price_History): expire departed offers, slide the
// last/first-minute windows, refresh aggregates, snapshot minimum prices, compute price drops, prune old rows.
// Every statement is written to touch only rows that actually change.
import type { Deps } from '../deps';
import { addDays, pragueToday, sqlTime } from '../util/text';
import { recomputeAggregates } from './hotels';
import { chunk, runBatches, MAX_PARAMS, qs } from './db';
import { afterRun } from './post';
import { reactivateRetired, retireHotels } from './lifecycle';

const RETENTION_DAYS = 180, DROP_MIN_PCT = 5, DROP_MIN_CZK = 500;

export interface DailyReport { expiredOffers: number; expiredProducts: number; windowFlags: number; hotelsWritten: number; snapshots: number; dropsSet: number; prunedHistory: number; prunedOffers: number; prunedProducts: number; prunedRuns: number; retiredHotels: number; reactivatedHotels: number }

export async function runDaily(deps: Deps): Promise<DailyReport> {
  const db = deps.env.DB;
  const now = deps.now();
  const today = pragueToday(now), nowSql = sqlTime(now);
  const lm = Number(deps.env.LAST_MINUTE_DAYS ?? 14) || 14, fm = Number(deps.env.FIRST_MINUTE_DAYS ?? 120) || 120;
  const r: DailyReport = { expiredOffers: 0, expiredProducts: 0, windowFlags: 0, hotelsWritten: 0, snapshots: 0, dropsSet: 0, prunedHistory: 0, prunedOffers: 0, prunedProducts: 0, prunedRuns: 0, retiredHotels: 0, reactivatedHotels: 0 };
  const changes = async (sql: string, ...v: unknown[]) => (await db.prepare(sql).bind(...v).run()).meta.changes ?? 0;

  // departures in the past, products past their validity
  r.expiredOffers = await changes('UPDATE offers SET active = 0 WHERE active = 1 AND departure_date < ?', today);
  r.expiredProducts = await changes('UPDATE products SET active = 0 WHERE active = 1 AND COALESCE(date_to, date_from) IS NOT NULL AND COALESCE(date_to, date_from) < ?', today);
  // sliding last/first minute windows: only rows whose flag actually flips are written
  const lmLimit = addDays(today, lm), fmLimit = addDays(today, fm);
  r.windowFlags = await changes('UPDATE offers SET is_last_minute = CASE WHEN departure_date <= ? THEN 1 ELSE 0 END, is_first_minute = CASE WHEN departure_date >= ? THEN 1 ELSE 0 END WHERE active = 1 AND (is_last_minute <> (departure_date <= ?) OR is_first_minute <> (departure_date >= ?))', lmLimit, fmLimit, lmLimit, fmLimit);

  // aggregates of every hotel that has (or had) active offers
  const ids = (await db.prepare('SELECT id FROM hotels WHERE offers_active > 0 OR id IN (SELECT DISTINCT hotel_id FROM offers WHERE active = 1)').all<{ id: number }>()).results.map((x) => x.id);
  r.hotelsWritten = (await recomputeAggregates(db, ids, { today, nowSql })).written;

  // hotels without offers for HOTEL_RETIRE_DAYS → 301 to their category; hotels with offers again → back
  r.reactivatedHotels = await reactivateRetired(db);
  r.retiredHotels = (await retireHotels(db, { now })).retired;

  // price history snapshot (idempotent per day) + drops vs ~7 days ago
  r.snapshots = await changes('INSERT INTO price_history (hotel_id, snap_date, min_price) SELECT id, ?, min_price FROM hotels WHERE offers_active > 0 AND min_price IS NOT NULL AND min_price > 0 ON CONFLICT (hotel_id, snap_date) DO UPDATE SET min_price = excluded.min_price WHERE price_history.min_price <> excluded.min_price', today);
  const ref = (await db.prepare('SELECT MAX(snap_date) AS d FROM price_history WHERE snap_date <= ?').bind(addDays(today, -7)).first<{ d: string | null }>())?.d;
  if (ref) {
    const hist = new Map((await db.prepare('SELECT hotel_id, min_price FROM price_history WHERE snap_date = ?').bind(ref).all<{ hotel_id: number; min_price: number }>()).results.map((x) => [x.hotel_id, x.min_price]));
    const hotels = (await db.prepare('SELECT id, min_price, offers_active, price_drop_pct, prev_min_price FROM hotels WHERE offers_active > 0 OR price_drop_pct > 0 OR prev_min_price IS NOT NULL').all<{ id: number; min_price: number | null; offers_active: number; price_drop_pct: number; prev_min_price: number | null }>()).results;
    const stmts = [];
    for (const h of hotels) {
      const old = hist.get(h.id) ?? null;
      let drop = 0, prev: number | null = null;
      if (h.offers_active > 0 && h.min_price && old) {
        prev = old;
        const diff = old - h.min_price;
        if (diff >= DROP_MIN_CZK && diff / old >= DROP_MIN_PCT / 100) drop = Math.round((100 * diff) / old);
      }
      if (h.offers_active === 0) prev = null;
      if (drop !== h.price_drop_pct || prev !== h.prev_min_price) { stmts.push(db.prepare('UPDATE hotels SET price_drop_pct = ?, prev_min_price = ? WHERE id = ?').bind(drop, prev, h.id)); r.dropsSet++; }
    }
    await runBatches(db, stmts);
  }

  // retention
  r.prunedHistory = await changes('DELETE FROM price_history WHERE snap_date < ?', addDays(today, -RETENTION_DAYS));
  r.prunedOffers = await changes('DELETE FROM offers WHERE active = 0 AND last_seen < ?', sqlTime(new Date(now.getTime() - 14 * 86400_000)));
  r.prunedProducts = await changes('DELETE FROM products WHERE active = 0 AND last_seen < ?', sqlTime(new Date(now.getTime() - 30 * 86400_000)));
  const oldRuns = (await db.prepare("SELECT id FROM import_runs WHERE started_at < ? AND status <> 'running'").bind(sqlTime(new Date(now.getTime() - 30 * 86400_000))).all<{ id: number }>()).results.map((x) => x.id);
  for (const part of chunk(oldRuns, MAX_PARAMS)) {
    await db.prepare(`DELETE FROM import_errors WHERE run_id IN (${qs(part.length)})`).bind(...part).run();
    r.prunedRuns += await changes(`DELETE FROM import_runs WHERE id IN (${qs(part.length)})`, ...part);
  }
  await afterRun(deps); // snapshots reflect the expired offers; sitemaps only if older than 20 h
  deps.log('daily.done', { ...r });
  return r;
}
