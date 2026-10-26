// Marketing year in titles/headings ("Dovolená Řecko 2027"). The texts migrated from WordPress have 2026 frozen in them.
//  - summer/general pages: from September people plan next season → next year
//  - winter, Christmas, Advent, New Year, skiing, last minute: the current calendar year
//  - pages with a dated window (month topics) get the window's year in src/lib/landing/topics.ts and are left alone
// Real dates ("8. 10. 2026", "říjen 2026") are never touched.
import { pragueNow, type Ymd } from './landing/dates';

export const FROZEN_YEAR = 2026;
const WINTER = /(vanoc|silvestr|advent|zim[ay]?|zimni|zime|lyz|hory|novy-rok|prosin)/i;
const MONTHS = '(?:leden|ledna|únor|února|březen|března|duben|dubna|květen|května|červen|června|červenec|července|srpen|srpna|září|říjen|října|listopad|listopadu|prosinec|prosince)';

export function seasonYear(t: Ymd = pragueNow()): number { return t.m >= 9 ? t.y + 1 : t.y; }

/** Target year for a page path (or slug). */
export function yearForPath(path: string, t: Ymd = pragueNow()): number {
  if (WINTER.test(path) || /last-minute/.test(path)) return t.y;
  return seasonYear(t);
}

const yearRe = (from: number) => new RegExp(`(?<!\\d\\.\\s?)(?<!${MONTHS}\\s)(?<![\\d/-])${from}(?![\\d/-])`, 'giu');

/** Replace the frozen marketing year in a string (not in dates, not in "2026/27", not in URLs/slugs). */
export function swapYear(s: string, to: number, from = FROZEN_YEAR): string {
  if (!s || from === to || !s.includes(String(from))) return s;
  return s.replace(yearRe(from), String(to));
}

/** Deep variant for topic definitions (cards, sections, FAQ…); href/url/path/src keys are left alone. */
export function swapYearDeep<T>(v: T, to: number, from = FROZEN_YEAR): T {
  if (typeof v === 'string') return swapYear(v, to, from) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => swapYearDeep(x, to, from)) as unknown as T;
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, /^(url|href|path|src|image|hero_image|filters|canonical)$/.test(k) ? x : swapYearDeep(x, to, from)])) as T;
  }
  return v;
}
