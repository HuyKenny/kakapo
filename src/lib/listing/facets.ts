// Port of Kakapo_Filters::facets — zero-filter state = global snapshot, otherwise hotel-level aggregation.
import { MEAL_BITS, MEAL_LABELS } from '../helpers';
import { loadFacets, loadRegistry, type FacetSnapshot } from '../snapshots';
import { normalizeFilters, themeConditionSql, type Filters } from '../search';
import { cachedJson } from './cache';

export interface Facets extends Partial<FacetSnapshot> {
  destinations?: Array<{ slug: string; label: string; cnt: number; min_price: number | null }>;
}

type Skip = 'country' | 'dest' | 'stars';

function build(f: Filters, skip: Skip[]): { where: string; params: unknown[] } {
  const where = ['h.offers_active > 0', 'h.hidden = 0']; const params: unknown[] = [];
  if (f.country && !skip.includes('country')) { where.push('h.country_slug = ?'); params.push(f.country); }
  if (f.dest && !skip.includes('dest')) { where.push('(h.destination_slug = ? OR h.city_slug = ?)'); params.push(f.dest, f.dest); }
  if (f.stars?.length && !skip.includes('stars')) where.push(`h.stars IN (${f.stars.map((s) => Math.trunc(s)).join(',')})`);
  if (f.rating_min) { where.push('h.rating >= ?'); params.push(f.rating_min); }
  if (f.price_min) { where.push('h.min_price >= ?'); params.push(f.price_min); }
  if (f.price_max) { where.push('h.min_price <= ?'); params.push(f.price_max); }
  if (f.flag) where.push(f.flag === 'last-minute' ? 'h.has_last_minute = 1' : 'h.has_first_minute = 1');
  if (f.theme) { const [s, p] = themeConditionSql(f.theme); if (s) { where.push(s); params.push(...p); } }
  return { where: where.join(' AND '), params };
}

async function compute(db: D1Database, f: Filters): Promise<Facets> {
  const all = async <T>(sql: string, params: unknown[]) => (await db.prepare(sql).bind(...params).all<T>()).results;
  const out: Facets = {};
  let b = build(f, ['country', 'dest']);
  out.countries = await all(`SELECT h.country_slug AS slug, h.country AS label, COUNT(*) AS cnt, MIN(h.min_price) AS min_price FROM hotels h WHERE ${b.where} GROUP BY h.country_slug, h.country ORDER BY cnt DESC LIMIT 50`, b.params);
  if (f.country) {
    b = build(f, ['dest']);
    out.destinations = await all(`SELECT h.destination_slug AS slug, h.destination AS label, COUNT(*) AS cnt, MIN(h.min_price) AS min_price FROM hotels h WHERE ${b.where} AND h.destination_slug != '' GROUP BY h.destination_slug, h.destination ORDER BY cnt DESC LIMIT 50`, b.params);
  }
  b = build(f, ['stars']);
  out.stars = await all(`SELECT h.stars AS value, COUNT(*) AS cnt FROM hotels h WHERE ${b.where} AND h.stars > 0 GROUP BY h.stars ORDER BY h.stars DESC`, b.params);
  b = build(f, []);
  const sums = Object.entries(MEAL_BITS).map(([slug, bit]) => `SUM(CASE WHEN (h.meal_flags & ${bit}) != 0 THEN 1 ELSE 0 END) AS "${slug}"`).join(', ');
  const row = (await all<Record<string, number>>(`SELECT ${sums} FROM hotels h WHERE ${b.where}`, b.params))[0] ?? {};
  out.meals = Object.keys(MEAL_BITS).filter((s) => (row[s] ?? 0) > 0).map((s) => ({ slug: s, label: MEAL_LABELS[s]!, cnt: row[s]! }));
  const reg = await loadRegistry(db);
  out.airports = Object.values(reg.airports);
  out.partners = Object.values(reg.partners);
  return out;
}

export async function facets(db: D1Database, filters: Record<string, unknown> | Filters): Promise<Facets> {
  const f = normalizeFilters(filters as Record<string, unknown>);
  const rest: Record<string, unknown> = { ...f };
  delete rest.page; delete rest.sort;
  if (!Object.keys(rest).length) return (await loadFacets(db)) as Facets;
  return cachedJson('facets:' + JSON.stringify(rest), 120, () => compute(db, f));
}
