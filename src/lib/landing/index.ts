// Landing pages: context, routing, SEO meta rules, sitemap helpers. See docs/LANDINGS.md.
export { landingContext, loadOverrides, normalizeFaqs, type LandingCtx, type LandingVars } from './pages';
export { resolveRoute, canonicalAliasTarget, legacyRedirect, MEAL_LANDINGS, type Route } from './route';
export { titleBudget, landingTitle, landingDescription, isIndexable, TITLE_MAX, DESC_MAX, MIN_INDEX_RESULTS } from './meta';
export { longtailSitemapLandings, longtailContext, hasEnoughResults, PRIORITY_COUNTRIES, TOPIC_SLUGS, DEST_TOPIC_SLUGS } from './longtail';
export { getTopic, getTopicStatic, topicPaths, topicSlugList, topicExists, sectionsToHtml, hubUrl, PARTNERS, type Topic } from './topics';
export { climateSection } from './climate';
export * as landingFacts from './facts';
export { pragueNow, monthRange, winterRange, ruleForSlug } from './dates';

import { topicPaths } from './topics';
/** Paths of the hand-written topic landings (sitemap; partner pages included, listing flag decided by the caller). */
export const topicSitemapPaths = (): string[] => topicPaths();
