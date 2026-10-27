import { describe, expect, it } from 'vitest';
import { ISO3, canonicalCountry, resolveCountry } from '../../workers/import/src/util/country';
import { normalizeHotel } from '../../workers/import/src/adapters/normalize';
import { slugify } from '../../workers/import/src/util/text';

describe('country canonicalisation', () => {
  it('maps the spellings feeds use to one name, so one country is one category', () => {
    for (const [from, to] of [['Česká republika', 'Česko'], ['Kapverdské ostrovy', 'Kapverdy'], ['Kambodza', 'Kambodža'], ['Kambozda', 'Kambodža'], ['Velka Britanie', 'Velká Británie'], ['Lotyssko', 'Lotyšsko'], ['Cina', 'Čína'], ['Indonésie - Bali, Lombok, Sulawesi', 'Indonésie']]) expect(canonicalCountry(from)).toBe(to);
    expect(canonicalCountry('Řecko')).toBe('Řecko');       // untouched
    expect(canonicalCountry('Madeira')).toBe('Madeira');   // regions with their own landing are NOT folded into a country
    expect(slugify(canonicalCountry('Česká republika'))).toBe('cesko');
  });
  it('knows the Čedok ISO codes that used to produce hotels without a country', () => {
    for (const c of ['LVA', 'LTU', 'QAT', 'MYS', 'GMB', 'BIH', 'SRB', 'JAM', 'BRB', 'CPV', 'ABW', 'CAN', 'SEN', 'MAF', 'CRI', 'CUW', 'TWN', 'ATG']) expect(ISO3[c], c).toBeTruthy();
  });
  it('derives a country from a well-known destination when the feed has none', () => {
    expect(resolveCountry('', 'Jižní Tyrolsko')).toBe('Itálie');
    expect(resolveCountry('', 'Riga')).toBe('Lotyšsko');
    expect(resolveCountry('', 'Neznámé místo')).toBe('');
    expect(resolveCountry('Egypt', 'Riga')).toBe('Egypt'); // a delivered country always wins
  });
  it('is applied when a hotel is normalised', () => {
    const r = normalizeHotel({ name: 'Hotel A', country: 'Česká republika', destination: 'Praha', city: 'Praha' });
    expect(r.ok && r.hotel.country).toBe('Česko');
    const s = normalizeHotel({ name: 'Hotel B', country: '', destination: 'Sella Ronda', city: '' });
    expect(s.ok && s.hotel.country).toBe('Itálie');
  });
});
