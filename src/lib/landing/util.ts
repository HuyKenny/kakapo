import { esc, formatPrice, countLabel, nightsLabel } from '../helpers';
export { esc, formatPrice, countLabel, nightsLabel };

/** number_format_i18n for cs_CZ: non-breaking space as thousands separator. */
export const nf = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const lower = (s: string): string => s.toLocaleLowerCase('cs');

const MONTH_NAMES = ['', 'leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
/** 'YYYY-MM' -> 'září' (year added when not the current one). */
export function monthLabel(ym: string, currentYear: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  const name = MONTH_NAMES[Number(m[2])] ?? ym;
  return Number(m[1]) === currentYear ? name : `${name} ${m[1]}`;
}

export interface Faq { q: string; a: string }
export interface Crumb { label: string; url: string }

/** Memo with TTL (per isolate). */
const memo = new Map<string, { at: number; v: unknown }>();
export async function remember<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as T;
  const v = await fn();
  memo.set(key, { at: Date.now(), v });
  if (memo.size > 2000) memo.delete(memo.keys().next().value as string);
  return v;
}
export const clearMemo = () => memo.clear();
export const FACT_TTL_MS = 10 * 60_000;
