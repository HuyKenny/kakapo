// Read side of Kakapo_Product_Repository on D1. Everything public filters `active = 1 AND hidden = 0`.
import { jsonArr, slugify } from '../helpers';
import { categoryExists } from './data';
import { foldText, likeEscape } from './search-text';

export interface ProductRow {
  id: number; feed_id: number; partner_slug: string; external_id: string; type: string; type_raw: string; slug: string; title: string;
  description: string | null; image_url: string | null; images: string[]; price: number; price_original: number | null; currency: string;
  country: string; country_slug: string; destination: string; place: string; nights: number | null; date_from: string | null; date_to: string | null;
  meal: string; transport: string; meta: any; active: number; hidden: number; updated_at: string; [k: string]: any;
}

function parseMeta(v: unknown): any {
  if (v && typeof v === 'object') return v;
  try { const d = JSON.parse(String(v ?? '')); return d && typeof d === 'object' ? d : {}; } catch { return {}; }
}
export function hydrate(r: any): ProductRow {
  return { ...r, images: jsonArr<string>(r.images_json), meta: parseMeta(r.meta_json) };
}

/** Active, not hidden (public detail). */
export async function getBySlug(db: D1Database, slug: string): Promise<ProductRow | null> {
  const r = await db.prepare('SELECT * FROM products WHERE slug = ? AND active = 1 AND hidden = 0').bind(slug).first<any>();
  return r ? hydrate(r) : null;
}
/** Any state — used to redirect vanished products to their category. */
export async function getBySlugAny(db: D1Database, slug: string): Promise<ProductRow | null> {
  const r = await db.prepare('SELECT * FROM products WHERE slug = ?').bind(slug).first<any>();
  return r ? hydrate(r) : null;
}

export interface ProductFilters {
  type?: string; country?: string; partner?: string; place?: string; kind?: string; q?: string;
  price_min?: number; price_max?: number; sort?: string; page?: number; per_page?: number;
}
export interface ProductSearch { products: ProductRow[]; total: number; page: number; pages: number }

const ORDER: Record<string, string> = {
  price: 'price ASC', price_desc: 'price DESC', date: 'date_from ASC, price ASC', title: 'title COLLATE NOCASE ASC',
};

export async function search(db: D1Database, f: ProductFilters): Promise<ProductSearch> {
  const where = ['active = 1', 'hidden = 0']; const args: unknown[] = [];
  if (f.type && categoryExists(f.type)) { where.push('type = ?'); args.push(f.type); }
  if (f.country) { where.push('country_slug = ?'); args.push(slugify(f.country)); }
  if (f.partner) { where.push('partner_slug = ?'); args.push(slugify(f.partner)); }
  if (f.place) { where.push('place = ?'); args.push(String(f.place)); }
  if (f.kind) { where.push('type_raw = ?'); args.push(String(f.kind)); }
  if (f.price_min) { where.push('price >= ?'); args.push(Math.trunc(f.price_min)); }
  if (f.price_max) { where.push('price <= ?'); args.push(Math.trunc(f.price_max)); }
  if (f.q) { where.push("search_text LIKE ? ESCAPE '\\'"); args.push('%' + likeEscape(foldText(f.q)) + '%'); }
  const orderBy = ORDER[f.sort ?? 'price'] ?? ORDER.price!;
  const perPage = Math.min(48, Math.max(6, Math.trunc(f.per_page ?? 24)));
  const page = Math.max(1, Math.trunc(f.page ?? 1));
  const w = where.join(' AND ');
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM products WHERE ${w}`).bind(...args).first<{ n: number }>())?.n ?? 0;
  const rows = (await db.prepare(`SELECT * FROM products WHERE ${w} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).bind(...args, perPage, (page - 1) * perPage).all<any>()).results;
  return { products: rows.map(hydrate), total, page, pages: Math.ceil(total / perPage) };
}

export async function similar(db: D1Database, p: ProductRow, limit = 4): Promise<ProductRow[]> {
  const rows = (await db.prepare(
    'SELECT * FROM products WHERE active = 1 AND hidden = 0 AND type = ? AND id <> ? ORDER BY (country_slug = ?) DESC, price ASC LIMIT ?',
  ).bind(p.type, p.id, p.country_slug, limit).all<any>()).results;
  return rows.map(hydrate);
}

export async function countsByType(db: D1Database): Promise<Record<string, { cnt: number; min_price: number }>> {
  const rows = (await db.prepare('SELECT type, COUNT(*) AS cnt, MIN(price) AS min_price FROM products WHERE active = 1 AND hidden = 0 GROUP BY type').all<any>()).results;
  return Object.fromEntries(rows.map((r) => [r.type, { cnt: r.cnt, min_price: r.min_price ?? 0 }]));
}

export interface FilterOptions {
  countries: Array<{ country: string; country_slug: string; cnt: number }>;
  partners: Array<{ partner_slug: string; cnt: number }>;
  places: Array<{ place: string; cnt: number }>;
  kinds: Array<{ type_raw: string; cnt: number }>;
  price: { min: number; max: number };
}
export async function filterOptions(db: D1Database, type: string): Promise<FilterOptions> {
  const base = 'active = 1 AND hidden = 0 AND type = ?';
  const [countries, partners, places, kinds, price] = await Promise.all([
    db.prepare(`SELECT country, country_slug, COUNT(*) AS cnt FROM products WHERE ${base} AND country <> '' GROUP BY country_slug ORDER BY cnt DESC LIMIT 10`).bind(type).all<any>(),
    db.prepare(`SELECT partner_slug, COUNT(*) AS cnt FROM products WHERE ${base} AND partner_slug <> '' GROUP BY partner_slug ORDER BY cnt DESC`).bind(type).all<any>(),
    db.prepare(`SELECT place, COUNT(*) AS cnt FROM products WHERE ${base} AND place <> '' GROUP BY place ORDER BY cnt DESC LIMIT 12`).bind(type).all<any>(),
    // numeric-only type_raw values are feed codes, not labels (MySQL: NOT REGEXP '^[0-9]+$')
    db.prepare(`SELECT type_raw, COUNT(*) AS cnt FROM products WHERE ${base} AND type_raw <> '' AND length(type_raw) >= 4 AND type_raw GLOB '*[^0-9]*' GROUP BY type_raw ORDER BY cnt DESC LIMIT 8`).bind(type).all<any>(),
    db.prepare(`SELECT MIN(price) AS min, MAX(price) AS max FROM products WHERE ${base} AND price > 0`).bind(type).first<any>(),
  ]);
  return { countries: countries.results, partners: partners.results, places: places.results, kinds: kinds.results, price: { min: price?.min ?? 0, max: price?.max ?? 0 } };
}
