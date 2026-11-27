// Hotel pages that rank in Google Search are never retired (301) — see scripts/static/gsc-keep.py, which refreshes the list
// from Search Console. A kept hotel without offers stays a 200 page ("no offers now" + similar hotels), indexable and in the sitemap.
import KEEP from '../../data/keep-hotels.json';

const SLUGS = new Set<string>(KEEP as string[]);
export const isKeptHotel = (slug: string): boolean => SLUGS.has(slug);
/** SQL list of kept slugs for code-owned constants (D1 allows max 100 bound parameters): slugs are validated, so a literal is safe. */
export const keptSlugsSql = (): string => [...SLUGS].filter((s) => /^[a-z0-9-]+$/.test(s)).map((s) => `'${s}'`).join(',') || "''";
