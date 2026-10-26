# Landing logic (port of the WordPress plugin)

Module: `src/lib/landing/` (entry `index.ts`). Everything is pure TypeScript over a D1 handle; no Astro imports, so
pages, middleware, sitemap and tests share it.

## API
| Export | Replaces (PHP) | Notes |
|---|---|---|
| `resolveRoute(db, pathname)` | `Kakapo_Router` rewrite rules + `resolve_country_urls` | `{page, vars}` or `null`. Pages: `search flag meal airport topic country longtail`. Hotel, product, legal, `/go`, `/akce` are NOT handled here. |
| `landingContext(db, page, vars)` | `Kakapo_Landing_Pages::context` | Same fields: `type filters h1 title description path canonical breadcrumbs intro seo_text faqs index_min`. `canonical` is a relative path (caller prefixes `siteUrl()`). Topic/partner pages also carry `topic` (eyebrow, hero_image, CTAs, cards, sections…). `null` = 404. |
| `landingTitle(ctx)` | `Kakapo_Seo::landing_title` / `topic_title` | Title kept while ≤ 60 chars, else rebuilt from H1 by `titleBudget`. |
| `landingDescription(ctx, total, {minPrice, firstDeparture, today})` | `Kakapo_Seo::landing_description` | Live numbers; the stored/override description is only the fallback for 0 results. Partner pages use `ctx.description` as-is (hydrated). |
| `isIndexable(ctx, total, {hasQuery, aliasTarget})` | `meta()` robots logic | index only when `total >= max(1,index_min)`, no query string, no alias. `index_min` per topic (8, 6, 12 default, 9999 for `/zlevneno/`). |
| `canonicalAliasTarget(path)`, `legacyRedirect(path)` | `canonical_alias_target`, `redirect_legacy` | 301 targets; the caller keeps the query string. |
| `longtailSitemapLandings(db)`, `topicSitemapPaths()` | `sitemap_landings`, topic list | Longtail = priority countries × topics with enough results (runs ~hundreds of count queries: call from the import/sitemap job, not per request). |
| `longtailContext`, `hasEnoughResults`, `getTopic`, `getTopicStatic`, `climateSection`, `hubUrl`, `landingFacts.*` | respective classes | |

Web Worker usage sketch:
```ts
const route = await resolveRoute(db, url.pathname);            // null → other routers → 404
const alias = canonicalAliasTarget(url.pathname);              // '' → no alias; else 301 (legacyRedirect covers both)
const ctx = await landingContext(db, route.page, route.vars);  // null → 404
const result = await search(db, normalizeFilters({ ...ctx.filters, ...fromQuery }));
const probe = await search(db, normalizeFilters({ ...ctx.filters, sort: 'price' }));
const title = landingTitle(ctx);
const description = ctx.topic?.partner_page ? ctx.description : landingDescription(ctx, result.total, { minPrice: probe.hotels[0]?.min_price, firstDeparture: result.hotels[0]?.best_offer?.departure_date, today });
const robots = isIndexable(ctx, result.total, { hasQuery: [...url.searchParams].length > 0, aliasTarget: alias }) ? 'index,follow' : 'noindex,follow';
```
Page 2+ (`?strana=2`) keeps a self canonical (`ctx.canonical + '?strana=N'`) and `noindex,follow`, as in `meta()`.

## Data and dates
* Static definitions (80 topic landings incl. 13 partner pages, 48 longtail topics, 18 priority-country texts, climate, aliases) are JSON in `src/data/` / `src/lib/landing/priority-countries.json`, dumped from the PHP classes. URLs inside are made host-relative (`rel()`/`relHtml()`).
* The dump froze date windows at 2026-10-26. `dates.ts` + `ruleForSlug()` recompute them for the current Prague date (month windows incl. year roll-over, winter, autumn, Christmas, Easter, relative "zítra/do týdne"); when a month window moves into another year the year in title/h1/description/intro/label is replaced. Hard-coded `2026` in PHP titles (e.g. `/albanie/`) stays hard-coded, exactly like the plugin.
* Overrides: `editorial_overrides(kind='landing', key=path, field ∈ h1,title,description,intro,seo_text,faqs_json)`. Legacy `/dovolena/` texts apply to `/zajezdy/`. Facts block ("… v číslech"), context links, partner links and climate table are appended after overrides, as in PHP.
* Facts come from SQL over `offers`/`hotels` (hidden hotels excluded), memoised 10 min per isolate (`FACT_TTL_MS`). No extra writes in the request path.

## Verification against the live site (26. 10. 2026)
Tool: `tests/landing/tools/oracle.ts` (needs network; builds a SQLite catalogue from `backups/kakapo-wp-export-2026-10-26` once, ~30 s). Compares `<title>`, `<h1>`, meta description, the H2 headings of our `seo_text` (must all appear on the live page) and robots/indexability.

24 URLs checked (/recko/, /recko/kos/, /last-minute/, /first-minute/, /zlevneno/, /all-inclusive/, /zajezdy/, /dovolena-u-more/, /odlet-z-prahy/, /egypt/hurghada/, /egypt/last-minute/, /egypt/dovolena-listopad/, /albanie/, /kypr/, /tunisko/djerba/, /turecko/antalya/all-inclusive/, /kapverdy/, /kam-v-rijnu-k-mori/, /kam-v-zime-k-mori/, /last-minute-z-prahy/, /cedok-zajezdy/, /fischer-last-minute/, plus the two alias URLs).

* **Identical:** route type, `<title>`, H1, all H2 headings of `seo_text`, indexability (incl. `/odlet-z-prahy/` = noindex, because the airport slug `prahy` does not exist — the live site behaves the same).
* **Only formatting differences:** the live meta description writes thousands separators as the literal entity `&nbsp;` (`1&nbsp;360 hotelů`), we emit U+00A0. After HTML decoding they are the same character.
* **Data drift, not logic:** `/kapverdy/` description minimum price 23 990 Kč (live) vs 25 589 Kč (our run over the 11:30 export; the `kapverdske-ostrovy` slug filter returns the same 19 hotels but a cheaper hotel appeared after the export).
* Redirects: `/kapverdske-ostrovy/` and `/egypt/egypt-hurghada/` answer 301 live; `canonicalAliasTarget` returns `/kapverdy/` and `/egypt/hurghada/`.

Unit tests: `tests/landing/landing.test.ts` — 21 tests, all passing (routing, aliases, contexts, priority copy, data FAQs, partner hydration without absolute URLs, overrides, title ≤ 60 for ~150 landings, indexability, date windows incl. Easter and year roll-over).

## Requests to other parts (not changed here)
1. `src/lib/search.ts`: export a count-only helper (`countHotels(db, filters)`); `longtailSitemapLandings` currently calls `search()` (24 rows + best-offer join) per combination.
2. Web Worker: the HTML cache key must include the Prague date (month windows and "odlet zítra" move at midnight) and `?strana`; persist nothing per request.
3. `site_cache` registry must be rebuilt after each import (already `rebuildSnapshots`) — routing depends on it.
4. Product landing paths (`/objevte/`, product categories, `/zazitek/…`) are intentionally not in `resolveRoute`; the caller should try them before declaring a 404. The PHP rewrite order puts topic landings before product paths, so check product-landing slugs that equal a topic slug.
5. `index_min` for `search`/`country`/`flag`/`meal` pages is undefined (= 1), like PHP; only topics, longtail and `/zlevneno/` set it.

## Not ported / open
* `Kakapo_Seo::meta()` parts outside landings (hotels, products, legal, home) and JSON-LD (FAQPage/ItemList for landings) — belong to the SEO/page owner; `ctx.faqs` is the single source for visible FAQs and the schema.
* `DEST_PHOTO_SLUGS` og:image mapping (`img/dest/{slug}.webp` for 17 countries) is a one-liner for the page layer.
* Admin "all landings" list (`all_landings()`), not needed by the public site.
