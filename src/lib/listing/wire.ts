// Glue between the listing loaders and the landing module (route resolution, canonical aliases, longtail chips).
// Reference wiring for the catch-all page: `const deps = await listingDeps(db)`.
import { canonicalAliasTarget, longtailContext, TOPIC_SLUGS } from '../landing';
import { loadRegistry } from '../snapshots';
import type { ListingDeps } from './landing-types';

export async function listingDeps(db: D1Database, extra: Partial<ListingDeps> = {}): Promise<ListingDeps> {
  const reg = await loadRegistry(db);
  return {
    canonicalAlias: canonicalAliasTarget,
    longtail: {
      topicSlugs: () => TOPIC_SLUGS,
      context: async (_db, country, dest, topic) => {
        const c = longtailContext(reg, country, dest, topic);
        return c ? { path: c.path, h1: c.h1, filters: c.filters, index_min: c.index_min } : null;
      },
    },
    ...extra,
  };
}
