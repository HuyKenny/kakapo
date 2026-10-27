// Countries ordered by search demand for "dovolená {země}" (Marketing Miner, 10/2026), used for sitewide links
// (header, footer, "other destinations" blocks) instead of ordering by hotel count. Slugs that are not live are skipped.
import type { Registry } from '../snapshots';

export const DEMAND_COUNTRIES = [
  'egypt', 'turecko', 'recko', 'chorvatsko', 'bulharsko', 'spanelsko', 'italie', 'tunisko', 'thajsko', 'maledivy', 'kypr', 'spojene-arabske-emiraty',
  'dominikanska-republika', 'portugalsko', 'albanie', 'kanarske-ostrovy', 'mauricius', 'zanzibar', 'kapverdy', 'cerna-hora', 'cesko',
];

/** Live countries in demand order. `min` = minimum hotels so that the page is worth linking (MIN_INDEX_RESULTS). */
export function demandCountries(reg: Registry, limit: number, opts: { exclude?: string; min?: number } = {}): Array<{ slug: string; label: string; cnt: number }> {
  const min = opts.min ?? 12;
  const out: Array<{ slug: string; label: string; cnt: number }> = [];
  for (const slug of DEMAND_COUNTRIES) {
    const c = reg.countries[slug];
    if (!c || c.cnt < min || slug === opts.exclude) continue;
    out.push({ slug, label: c.label, cnt: c.cnt });
    if (out.length >= limit) break;
  }
  return out;
}
