// Contract with src/lib/landing (written by another fork): same fields as PHP Kakapo_Landing_Pages::context().
import type { Filters } from '../search';

export interface Crumb { label: string; url?: string }
export interface Faq { q: string; a: string }
export interface LandingCtx {
  type: string;
  /** PHP-style filters (meal/airport/partner/stars as arrays, scalars otherwise); passed through normalizeFilters(). */
  filters: Record<string, unknown>;
  h1: string;
  title: string;
  description: string;
  /** Site-relative path with leading and trailing slash, e.g. /recko/kos/ */
  path: string;
  breadcrumbs: Crumb[];
  intro?: string;
  seo_text?: string;
  faqs?: Faq[];
  index_min?: number;
  canonical?: string;
  /** Hydrated topic definition (topic / partner pages) */
  topic?: any;
  [k: string]: unknown;
}

/** Longtail landing provider (Kakapo_Longtail_Landings) used for the "related selections" chips. */
export interface LongtailProvider {
  topicSlugs(): string[];
  context(db: D1Database, country: string, dest: string, topic: string): Promise<{ path: string; h1: string; filters: Record<string, unknown>; index_min?: number } | null>;
}

export interface ListingDeps {
  topicSlug?: string;
  longtail?: LongtailProvider;
  /** Kakapo_Seo::canonical_alias_target — '' when the path is no alias */
  canonicalAlias?: (path: string) => string;
  /** YYYY-MM-DD in Europe/Prague; override in tests */
  today?: string;
  /** site_cache data_version: when set, the clean first page (search + facets) is cached in D1 per version */
  dataVersion?: string;
}
export type { Filters };
