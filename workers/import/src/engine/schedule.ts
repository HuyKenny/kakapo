import { addDays, pragueHour, pragueLocalToUtc, pragueToday, sqlTime } from '../util/text';

/** "0-7" -> [0,7]; empty / equal numbers disable the window (always open). */
export function parseWindow(v: string | undefined): [number, number] | null {
  const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec((v ?? '').trim());
  if (!m) return null;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === b ? null : [a, b];
}
export function windowOpen(now: Date, win: [number, number] | null): boolean {
  if (!win) return true;
  const h = pragueHour(now);
  return win[0] < win[1] ? h >= win[0] && h < win[1] : h >= win[0] || h < win[1];
}
/** Same rule as the WP scheduler: with a night window a feed runs once per max(1, floor(interval/24)) days at the window start. */
export function nextRunAt(now: Date, intervalHours: number, win: [number, number] | null): string {
  if (win) {
    const days = Math.max(1, Math.floor(Math.max(1, intervalHours) / 24));
    return sqlTime(pragueLocalToUtc(addDays(pragueToday(now), days), win[0]));
  }
  return sqlTime(new Date(now.getTime() + Math.max(1, intervalHours) * 3600_000));
}
