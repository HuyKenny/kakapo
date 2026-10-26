// Resolves any non-explicit path: legacy/alias 301 → product section → hotel landing family → null (404).
import { legacyRedirect, resolveRoute, landingContext, longtailContext, TOPIC_SLUGS, DEST_TOPIC_SLUGS, canonicalAliasTarget, type LandingCtx } from './landing';
import { resolveProductRoute, type ProductRoute } from './products';
import { loadRegistry } from './snapshots';
import type { ListingDeps } from './listing';

export type Dispatch =
  | { kind: 'redirect'; to: string; status: 301 }
  | { kind: 'product'; route: ProductRoute }
  | { kind: 'listing'; ctx: LandingCtx; deps: ListingDeps }
  | { kind: 'topic'; ctx: LandingCtx; topic: any }
  | { kind: 'notfound' };

export function longtailProvider(): NonNullable<ListingDeps['longtail']> {
  return {
    topicSlugs: () => [...new Set([...TOPIC_SLUGS, ...DEST_TOPIC_SLUGS])],
    context: async (db, country, dest, topic) => {
      const reg = await loadRegistry(db);
      const c = longtailContext(reg, country, dest, topic);
      return c ? { path: c.path, h1: c.h1, filters: c.filters as Record<string, unknown>, ...(c.index_min !== undefined ? { index_min: c.index_min } : {}) } : null;
    },
  };
}

export async function dispatch(db: D1Database, pathname: string): Promise<Dispatch> {
  const legacy = legacyRedirect(pathname);
  if (legacy) return { kind: 'redirect', to: legacy, status: 301 };

  const route = await resolveRoute(db, pathname);
  if (route) {
    const ctx = await landingContext(db, route.page, route.vars);
    if (!ctx) return { kind: 'notfound' };
    if (route.page === 'topic') {
      const topic = (ctx as any).topic;
      if (topic && !topic.listing) return { kind: 'topic', ctx, topic };
    }
    return { kind: 'listing', ctx, deps: { ...(route.vars.topic ? { topicSlug: route.vars.topic } : {}), longtail: longtailProvider(), canonicalAlias: canonicalAliasTarget } };
  }

  const pr = await resolveProductRoute(db, pathname);
  if (pr) return pr.kind === 'redirect' ? { kind: 'redirect', to: (pr as any).to, status: 301 } : { kind: 'product', route: pr };
  return { kind: 'notfound' };
}
