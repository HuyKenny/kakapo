# Listing, homepage, topic pages, /api/search

Stav: 26. 10. 2026. Kód: `src/lib/listing/**`, `src/components/{listing,home}/**`, `src/pages/index.astro`, `src/pages/api/{search,filters}.ts`, testy `tests/listing/**`.

## Kontrakt (pro catch-all `[...path].astro` / `dispatch.ts`)
- `loadListing(db, ctx, query, deps)` → `ListingData` (`result`, `facets`, `meta{title,description,canonical,robots[],image,jsonLd[]}`, bloky pod výpisem). Komponenta `Listing.astro` (`data`, `url`, `today`).
- `loadTopic(topic|slug, query)` → `{topic, meta}`; komponenta `TopicLanding.astro` (topic bez výpisu).
- `loadHome(db)` + `Home.astro`; `listingDeps(db)` v `src/lib/listing/wire.ts` skládá `deps` (canonicalAlias, longtail chips) z `src/lib/landing`.
- `meta.robots` je pole (`['index','follow']`); živý web tiskne `index, follow` s mezerou (Rank Math) — `Base.astro` spojuje čárkou bez mezery. Obsahově shodné, jen formát.
- SEO pravidla: title/description/`isIndexable` se berou z `src/lib/landing/meta.ts` (jedna implementace). Meta se počítá z filtrů landingu bez GET (jako PHP `meta()`), noindex = jakýkoli GET parametr / málo výsledků / alias; `?strana=N` má self canonical.
- Fasety: bez filtrů = snapshot `loadFacets`; s filtry hotel-level SQL (jako `compute_facets`) + Cache API 120 s. Čipy „Související výběr“/„Oblíbené výběry“ (až 48 počtů) se počítají jednou za hodinu na landing (isolate memo).

## Testy (`npx vitest run tests/listing`): 16/16 prošlo
Paginace (24/stránka), GET přebíjí filtry, noindex/canonical varianty, alias, title ≤ 60, description s čísly, JSON-LD (Breadcrumb vždy; FAQ+ItemList jen indexovatelné), filtry (jídlo, last minute, cena, hvězdy), prázdný výsledek, fasety (snapshot, bitmask strava), tvar `/api/search` (klíče 1:1 s `renderCard()` v `frontend.js`), home (bez zahraničních zemí), topic.

## Oracle proti živému webu (`npx tsx tests/listing/oracle.ts [cesty]`)
Živé HTML (curl, UA Chrome 141; node fetch a UA s příponou dostane Cloudflare challenge) vs. `loadListing/loadHome` nad SQLite z exportu 26. 10.
Shoda u `/zajezdy/`, `/last-minute/`, `/recko/`, `/all-inclusive/`, `/dovolena-u-more/`, `/egypt/hurghada/`, `/last-minute-all-inclusive/`, `/cedok-zajezdy/`, `/` (title, description, canonical, robots, H1, počet karet, prvních 5 hotelů, štítek počtu, počet FAQ, přítomnost SEO textu; home: počet hotelových karet a první „nejlépe hodnocený“).
Rozdíly: pouze formát robots (viz výše).
**Query varianty nelze živě ověřit:** edge cache Cloudflare vrací pro `/recko/?strana=2`, `?meal=…` HTML čisté landingu (`cf-cache-status: HIT`, canonical bez `strana`, `index, follow`) — cache klíč ignoruje query. Nový Worker musí mít query v cache klíči (nebo varianty necachovat) a vracet `noindex`.

## Chybí / neověřeno
- Stránky nebyly vyrenderovány v běžícím workerd (build `astro build` prochází, vizuální/HTML kontrola Alpine markupu a `frontend.js` s `/api/*` nebyla provedena).
- Cenový kalendář (`price_history` se nepoužívá, jde o `offers`), `top_drops` a karty produktů na home jsou lokální kopie (produktová karta bez ikony kategorie).
- HTML z editoračních textů (`seo_text`, FAQ) se nesanitizuje (`wp_kses_post` není); zdrojem je jen admin/kód.
- Test helper `tests/landing/d1.ts` je sdílený s forkem landingů.
