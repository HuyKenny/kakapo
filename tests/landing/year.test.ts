import { describe, expect, it } from 'vitest';
import { seasonYear, swapYear, yearForPath } from '../../src/lib/year';

const oct = { y: 2026, m: 10, d: 26 }; const jun = { y: 2026, m: 6, d: 1 }; const jan = { y: 2027, m: 1, d: 10 };
describe('marketing year', () => {
  it('summer/general pages switch to next year from September', () => {
    expect(seasonYear(jun)).toBe(2026); expect(seasonYear(oct)).toBe(2027); expect(seasonYear(jan)).toBe(2027);
    expect(yearForPath('/recko/', oct)).toBe(2027); expect(yearForPath('/cedok-zajezdy/', oct)).toBe(2027);
  });
  it('winter, Christmas, Advent, skiing and last minute keep the current year', () => {
    for (const p of ['/adventni-zajezdy/', '/silvestr-u-more/', '/lyzovani/', '/kam-v-zime-k-mori/', '/last-minute/', '/cedok-last-minute/']) expect(yearForPath(p, oct)).toBe(2026);
  });
  it('replaces the marketing year but never dates, seasons like 2026/27 or slugs', () => {
    expect(swapYear('Dovolená Řecko 2026 — zájezdy | Kakapo.cz', 2027)).toBe('Dovolená Řecko 2027 — zájezdy | Kakapo.cz');
    expect(swapYear('odlety od 8. 10. 2026', 2027)).toBe('odlety od 8. 10. 2026');
    expect(swapYear('nejlevnější je říjen 2026', 2027)).toBe('nejlevnější je říjen 2026');
    expect(swapYear('zima 2026/27', 2027)).toBe('zima 2026/27');
    expect(swapYear('<a href="/x-2026/">Dovolená 2026</a>', 2027)).toBe('<a href="/x-2026/">Dovolená 2027</a>');
  });
});
