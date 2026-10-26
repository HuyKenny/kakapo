// Price calendar ("Kdy je nejlevněji") and top drops (homepage). Port of Kakapo_Price_History::months/top_drops.
import { jsonArr } from '../helpers';
import { DROP_MIN_PCT, type HotelRow } from '../search';
import { memoized } from './cache';

const MONTHS_CS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
/** 2026-10 → "říjen 2026" (Kakapo_Price_History::month_label) */
export function monthLabel(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  return m ? `${MONTHS_CS[Number(m[2]) - 1]} ${m[1]}` : ym;
}

export async function calendarMonths(db: D1Database, country: string, dest: string, today: string): Promise<Array<{ ym: string; mp: number }>> {
  if (!country) return [];
  return memoized(`cal:${country}:${dest}:${today}`, 3600, async () => {
    const cond = dest ? ' AND (h.destination_slug = ? OR h.city_slug = ?)' : '';
    const params: unknown[] = [today, country, ...(dest ? [dest, dest] : [])];
    return (await db.prepare(
      `SELECT substr(o.departure_date, 1, 7) AS ym, MIN(o.price_pp) AS mp FROM offers o INNER JOIN hotels h ON h.id = o.hotel_id
       WHERE o.active = 1 AND o.departure_date >= ? AND h.country_slug = ?${cond} GROUP BY ym ORDER BY ym ASC LIMIT 12`,
    ).bind(...params).all<{ ym: string; mp: number }>()).results;
  });
}

export async function topDrops(db: D1Database, limit = 8): Promise<HotelRow[]> {
  const rows = (await db.prepare('SELECT * FROM hotels WHERE offers_active > 0 AND hidden = 0 AND price_drop_pct >= ? ORDER BY price_drop_pct DESC, min_price ASC LIMIT ?').bind(DROP_MIN_PCT, limit).all<any>()).results;
  return rows.map((r) => ({ ...r, images: jsonArr<string>(r.images_json), best_offer: null }));
}
