// Product categorisation (port of Kakapo_Product_Categories::categorize, keyword lists only).
import { removeAccents } from '../util/text';

export const PRODUCT_TYPES = ['poznavaci', 'vzdelavaci', 'zazitky', 'wellness', 'plavby', 'eurovikendy', 'lyzovani', 'zajezdy'] as const;
export const typeExists = (t: string) => (PRODUCT_TYPES as readonly string[]).includes(t);

const KEYWORDS: Record<string, string[]> = {
  plavby: ['plavb', 'cruise'],
  lyzovani: ['lyz', 'ski', 'hory', 'skipas'],
  vzdelavaci: ['vzdelavac', 'studijni', 'odborn', 'seminar', 'kurz', 'workshop', 'tradicni', 'kultura'],
  eurovikendy: ['eurovikend', 'city break', 'advent', 'adventni', 'vanocni trh', 'vanocni', 'metropole', 'prodlouzeny vikend', 'vikend v', 'vikend ve', 'vikendova',
    'viden', 'vidni', 'prater', 'pariz', 'benatk', 'budapest', 'krakov', 'londyn', 'amsterdam', 'berlin', 'drazdan', 'mnichov', 'salzburg', 'brusel', 'stockholm',
    'kodan', 'oslo', 'goteborg', 'zahreb', 'ljublan', 'florenc', 'barcelon', 'madrid', 'lisabon', 'monako'],
  poznavaci: ['poznavac', 'okruh', 'za poznanim', 'historie'],
  wellness: ['wellness', 'lazn', 'relax', 'spa', 'termaln'],
  zazitky: ['zazitk', 'romantik', 'glamping', 'darek', 'pro dva', 'pobyt pro'],
  zajezdy: ['u more', 'pobytovy', 'all inclusive', 'plaz'],
};
const TOUR_TYPE: Record<string, string> = { '100': 'zajezdy', '200': 'poznavaci', '210': 'poznavaci', '300': 'eurovikendy', '400': 'plavby', '500': 'lyzovani' };

function isCruiseSignal(signal: string): boolean {
  const s0 = signal.trim();
  if (s0 === '' || [...s0].length > 180) return false;
  const s = removeAccents(s0.toLowerCase());
  if (s === '400' || s.includes('plavba lodi') || s.includes('plavby lodi')) return true;
  return s.includes('plavb') || s.includes('cruise');
}

export function categorize(signals: string[], def = 'zajezdy'): string {
  const hay = removeAccents(signals.join(' | ').toLowerCase());
  for (const w of KEYWORDS.eurovikendy!) if (hay.includes(w)) return 'eurovikendy';
  for (const s of signals) { const t = s.trim(); if (t !== '' && TOUR_TYPE[t]) return TOUR_TYPE[t]!; }
  for (const s of signals) if (isCruiseSignal(s)) return 'plavby';
  for (const [type, words] of Object.entries(KEYWORDS)) {
    if (type === 'eurovikendy' || type === 'plavby') continue;
    for (const w of words) if (hay.includes(w)) return type;
  }
  return typeExists(def) ? def : 'zajezdy';
}
