# Detail hotelu (`/hotel/{slug}/`)

Port of `templates/hotel.php` + hotel parts of `Kakapo_Seo`, `Kakapo_Offer_Repository`, `Kakapo_Price_History`. Markup is 1:1 with the PHP template so the compiled `kakapo.css` and the Alpine components `kakapoGallery` / `kakapoOffers` in `frontend.js` keep working (Alpine attributes use the long forms `x-on:` / `x-bind:`).

## Files
- `src/lib/hotel/index.ts` — `loadHotel(db, slug, opts)` → `{kind:'ok', view}` | `{kind:'redirect', to, status}` | `{kind:'gone'}` | `null` (404; `hidden=1` is a 404). Also `offersForHotel`, `toOfferView`, `realDropPct`, `hotelIsIndexable`, `withinGrace`, `hotelTitle`, `sparklineSvg`, `monthLabel`, `offerTerm`.
- `src/lib/hotel/text.ts` — `autop()` for FAQ answers.
- `src/pages/hotel/[slug].astro` — the page (uses `layouts/Base.astro`; 404 via `Astro.rewrite('/404')`, 301 via `Astro.redirect`, 410 plain).
- `src/pages/api/hotels/[id]/offers.ts` — `GET /api/hotels/{id}/offers?sort=price|departure|nights|discount&month=YYYY-MM`, same JSON as the WP REST endpoint (`{offers:[…]}`; fields `partner`, `partner_slug`, `discount`, `real_drop`, `go_url`, …). `window.KAKAPO.rest` is `/api` (set in `Base.astro`).
- `src/components/hotel/HotelCard.astro` — local copy of `card-hotel.php` (used by "Podobné zájezdy"); swap for the shared listing card when it exists.
- `tests/hotel/` — 15 vitest tests (`d1.ts` = D1 shim over `node:sqlite` + the real `0001_init.sql`), `oracle.ts` = comparison against the live site.

## Behaviour kept from PHP
Title budget 60 (`ceny {rok}` + place + brand only if they fit), description ≤ 158 (offers/sold-out variants, rating only if ≥ 3 ratings and ≥ 7,0), robots = `hotel_is_indexable` (description ≥ 200 chars or an image; with 0 offers only inside the 180-day grace period), canonical, og:image, JSON-LD `@graph` (BreadcrumbList, Hotel with AggregateOffer/AggregateRating/amenities/geo, WebPage with dateModified, FAQPage). FAQ, "Pro koho se hotel hodí" and "V čem se nabídky liší" are computed only from the hotel's own offers (sections vanish when there is nothing to say). Sold-out state shows last known price, sparkline and nearby hotels with a price. Offers: active, `departure_date >= today (Europe/Prague)`, max 100; real drop needs ≥ 5 %, ≥ 300 Kč and ≤ 7 days. Links are `/go/{id}/?ctx=hotel-detail` with `rel="nofollow sponsored noopener"` and `data-kakapo-partner` / `data-kakapo-price` (GA4 event).

## Oracle vs. live site (26. 10. 2026, local D1 built from `backups/kakapo-wp-export-2026-10-26`)
`npx tsx scripts/migrate-from-wp.ts <export> /tmp/kk-sql && npx tsx tests/hotel/oracle.ts /tmp/kk-sql [slug …]` fetches the live page (UA `KakapoSeoSnapshot/1.0 …`, Cloudflare blocks other UAs) and compares `<title>`, meta description, robots, canonical, H1, number of server-rendered offer rows, H2 sections and FAQ questions.
Result: **16 of 16 hotels identical** (multi-partner hotels with 8 offers, 1-offer hotels, a hotel with a rating, sold-out hotels in grace, sold-out and noindex hotels outside grace). The only discrepancy found on the first run was the order of partners with equal minimum price in the description (`CK Fischer` vs `Exim Tours`): MySQL returned them in offer-id order, now reproduced (`ORDER BY price_pp, id`).
Not compared: price/offer cell values (live data moved by minutes), similar/nearby hotel lists, sparkline path, gallery markup (not testable without rendering the Astro page — see below).

## Not verified / limitations
- **The `.astro` page was only type-checked (`npx astro check`, 0 errors in hotel files); it was never rendered or built** (Node 22.23.1 on the Pi; the project is pinned to Astro 7.3.8). Needs a `wrangler dev` / staging render check against the live HTML (gallery, tables, Alpine hydration).
- Reviews are omitted: the PHP `reviews` table is empty and has no registered source.
- No rate limit on the offers API (add `RL_SEARCH`/`RL_GO` in `wrangler.jsonc` if wanted); response is `public, max-age=60, s-maxage=300`.
- `longtailLink` (related chips "Řecko all inclusive" etc.) is injected: the page picks `longtailLink(db, country, dest, topic)` from `src/lib/landing/index.ts` if that module exports it (mirror of PHP `longtail_link()`: `{h1,path}` when the landing has enough results, else `null`). Until then the "Související výběr" chips lack those 2–3 longtail links. **Request to the landing module/parent: export `longtailLink`.**

## Requests to other modules / parent
1. **Merged-hotel 301s:** PHP keeps them in the option `kakapo_hotel_redirects` (old slug → winner slug). It is **not** in the export whitelist (`/maintenance/export?table=_wp`) nor in `migrate-from-wp.ts`. Add the option to the whitelist and load it into `redirects` as `from_path='/hotel/{old}/'`, `to_path='/hotel/{new}/'`, `status=301`, `reason='merge'` — `loadHotel` already resolves it from there (`410` rows → `{kind:'gone'}`). `hotel_aliases` (dedup keys) are an import concern and are not used for URLs.
2. `src/pages/404.astro` must exist and render with status 404 (`Astro.rewrite('/404')`).
3. Middleware: the page does its own 301/404/410; the generic `redirects` table lookup in middleware should skip `/hotel/` (or run before) to avoid two lookups. HTML cache should key on path and bypass `?cb=` like other pages; hotel pages carry live prices (TTL ≤ 300 s).
4. `Base.astro` prints `jsonLd` objects one `<script>` each; hotel passes a single `{ '@context', '@graph' }` object (same shape as the plugin).
5. Prices come from `offers` rows; `hotels.min_price/offers_active` aggregates must be recomputed by the importer after each run (the page trusts them for header price, description and noindex).
