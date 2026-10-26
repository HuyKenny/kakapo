// Shared request-time data for layout/pages (memoised per isolate for a short time).
import { getEnv } from './env';
import { loadRegistry, type Registry } from '../snapshots';
import categories from '../../data/product-categories.json';

export interface ProductCategory { path: string; label: string; photo?: string; [k: string]: unknown }
export const PRODUCT_CATEGORIES = categories as unknown as Record<string, ProductCategory>;

export const db = (): D1Database => getEnv().DB;
export const registry = (): Promise<Registry> => loadRegistry(db());

let countsMemo: { at: number; v: Record<string, number> } | null = null;
export async function productCounts(): Promise<Record<string, number>> {
  if (countsMemo && Date.now() - countsMemo.at < 300_000) return countsMemo.v;
  const rows = (await db().prepare('SELECT type, COUNT(*) AS cnt FROM products WHERE active = 1 AND hidden = 0 GROUP BY type').all<{ type: string; cnt: number }>()).results;
  const v = Object.fromEntries(rows.map((r) => [r.type, r.cnt]));
  countsMemo = { at: Date.now(), v };
  return v;
}
export const GA4_ID = 'G-WHF1DJMDBB';
