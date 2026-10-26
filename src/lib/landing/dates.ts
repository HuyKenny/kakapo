// Date windows used by dated landings (ported from Kakapo_Topic_Landings / Kakapo_Longtail_Landings).
// "now" is always Prague local time, like WordPress current_time().

export interface Ymd { y: number; m: number; d: number }
export interface Range { from: string; to: string; year: number }

export function pragueNow(now = new Date()): Ymd {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(now); // YYYY-MM-DD
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return { y, m, d };
}
const p2 = (n: number) => String(n).padStart(2, '0');
export const fmt = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${p2(m)}-${p2(d)}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (t: Ymd, n: number): string => { const dt = new Date(Date.UTC(t.y, t.m - 1, t.d + n)); return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); };

export function monthRange(month: number, t = pragueNow()): Range {
  let year = t.y;
  if (month < t.m) year++;
  const fromDay = month === t.m ? t.d : 1;
  return { from: fmt(year, month, fromDay), to: fmt(year, month, daysIn(year, month)), year };
}
export function winterRange(t = pragueNow()): Range {
  if (t.m >= 1 && t.m <= 3) return { from: fmt(t.y, t.m, t.d), to: fmt(t.y, 3, 31), year: t.y };
  return { from: fmt(t.y, 12, 1), to: fmt(t.y + 1, 3, 31), year: t.y };
}
export function autumnRange(t = pragueNow()): Range {
  if (t.m >= 9 && t.m <= 11) return { from: fmt(t.y, t.m, t.d), to: fmt(t.y, 11, 30), year: t.y };
  const y = t.m === 12 ? t.y + 1 : t.y;
  return { from: fmt(y, 9, 1), to: fmt(y, 11, 30), year: y };
}
export function christmasRange(t = pragueNow()): Range {
  return { from: fmt(t.y, 12, 20), to: fmt(t.y, 12, 31), year: t.y };
}
function easterDate(year: number): { y: number; m: number; d: number } {
  const a = year % 19, b = Math.trunc(year / 100), c = year % 100, d = Math.trunc(b / 4), e = b % 4, f = Math.trunc((b + 8) / 25);
  const g = Math.trunc((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.trunc(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.trunc((a + 11 * h + 22 * l) / 451);
  const month = Math.trunc((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return { y: year, m: month, d: day };
}
export function easterRange(t = pragueNow()): Range {
  const todayMs = Date.UTC(t.y, t.m - 1, t.d, 12);
  for (let i = 0; i < 3; i++) {
    const e = easterDate(t.y + i); const em = Date.UTC(e.y, e.m - 1, e.d, 12);
    if (em + 4 * 864e5 >= todayMs) return { from: addDays({ y: e.y, m: e.m, d: e.d }, -7), to: addDays({ y: e.y, m: e.m, d: e.d }, 4), year: t.y + i };
  }
  throw new Error('unreachable');
}
export function relativeRange(fromDays: number, toDays: number, t = pragueNow()): Range {
  return { from: addDays(t, fromDays), to: addDays(t, toDays), year: t.y };
}

/** How a dated topic derives its window. Rules were recovered from the PHP sources (month number from the slug etc.). */
export type DateRule =
  | { kind: 'month'; month: number }
  | { kind: 'winter' } | { kind: 'autumn' } | { kind: 'christmas' } | { kind: 'easter' }
  | { kind: 'relative'; from: number; to: number };

export function resolveRule(rule: DateRule, t = pragueNow()): Range {
  switch (rule.kind) {
    case 'month': return monthRange(rule.month, t);
    case 'winter': return winterRange(t);
    case 'autumn': return autumnRange(t);
    case 'christmas': return christmasRange(t);
    case 'easter': return easterRange(t);
    case 'relative': return relativeRange(rule.from, rule.to, t);
  }
}
const MONTH_BY_NAME: Array<[RegExp, number]> = [
  [/(^|-)(leden|lednu)(-|$)/, 1], [/(^|-)(unor|unoru)(-|$)/, 2], [/(^|-)(brezen|breznu)(-|$)/, 3], [/(^|-)(duben|dubnu)(-|$)/, 4],
  [/(^|-)(kveten|kvetnu)(-|$)/, 5], [/(^|-)(cerven|cervnu)(-|$)/, 6], [/(^|-)(cervenec|cervenci)(-|$)/, 7], [/(^|-)(srpen|srpnu)(-|$)/, 8],
  [/(^|-)(zari)(-|$)/, 9], [/(^|-)(rijen|rijnu)(-|$)/, 10], [/(^|-)(listopad|listopadu)(-|$)/, 11], [/(^|-)(prosinec|prosinci)(-|$)/, 12],
];
/** Rule by slug for topic landings (class-topic-landings.php) and longtail topics. null = slug has no dated window. */
export function ruleForSlug(slug: string): DateRule | null {
  const rel: Record<string, [number, number]> = {
    'super-last-minute-odlet-dnes': [0, 0], 'super-last-minute-odlet-zitra': [1, 1], 'ultra-last-minute-odlet-do-24-hodin': [0, 1],
    'super-last-minute-odlet-do-tydne': [0, 7], 'last-minute-odlet-zitra': [1, 1], 'odlet-zitra-z-prahy': [1, 1],
    'last-minute-odlet-z-brna': [0, 7], 'last-minute-odlet-z-ostravy': [0, 7],
  };
  if (rel[slug]) return { kind: 'relative', from: rel[slug]![0], to: rel[slug]![1] };
  if (slug === 'kam-v-zime-k-mori') return { kind: 'winter' };
  if (slug === 'kam-na-vanoce-k-mori') return { kind: 'christmas' };
  if (slug === 'kam-na-podzim-k-mori') return { kind: 'autumn' };
  if (slug === 'kam-na-velikonoce-k-mori') return { kind: 'easter' };
  if (/^(kam-v-.+-k-mori|dovolena-(kveten|cerven|cervenec|srpen|zari|rijen|listopad|prosinec)|dovolena-v-(zari-u-more|prosinci))$/.test(slug)) {
    for (const [re, m] of MONTH_BY_NAME) if (re.test(slug)) return { kind: 'month', month: m };
  }
  return null;
}
