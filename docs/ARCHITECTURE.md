# Architektura (stav 26. 10. 2026)

```
návštěvník ─► Cloudflare (zóna kakapo.cz) ─► Worker kakapo (Astro SSR, adaptér @astrojs/cloudflare)
                                              ├─ middleware: host allowlist, Access (staging/admin), redirecty (D1 `redirects`), Cache API (HTML, 300 s,
                                              │   klíč = host + cesta + whitelist parametrů + data_version + build), bezpečnostní hlavičky
                                              ├─ stránky: /, /hotel/[slug], /zazitek/[slug], /objevte, právní, [...path] (landingy, produktové kategorie)
                                              ├─ /api/search, /api/filters, /api/hotels/{id}/offers (JSON pro frontend.js)
                                              ├─ /go/{offer}, /akce/{product} (affiliate 302, boti 204, klik → D1 přes waitUntil)
                                              ├─ /admin, /api/admin/* (Cloudflare Access + CSRF)
                                              └─ sitemap_index.xml, kakapo-sitemap{N}.xml, sitemap-kakapo.xml, robots.txt (ze `site_cache`)
                    D1 kakapo-<env>  ◄─────── Worker kakapo-import (cron */10, denní údržba 01:30; HTTP API s IMPORT_SHARED_SECRET)
                    R2 kakapo-snapshots-<env> ◄── normalizované bloky NDJSON, Čedok slim feed (PUT z Maliny)
```

Verze: Astro 7.3.8, @astrojs/cloudflare 14.3.4, wrangler 4.152.0 (lockfile `pnpm-lock.yaml`). Astro 7.4.2 se nedá použít: vyžaduje Node ≥ 22.23.4, na Malině je 22.23.1.

Principy
- Katalog se negeneruje při buildu. Ceny a dostupnost se čtou z D1 při požadavku; po importu import Worker zvýší `data_version` v `site_cache`, takže všechny cache klíče se změní (změna ceny je vidět hned po importu, ne po TTL).
- Těžké agregace (registry zemí/destinací/letišť, globální fasety, sitemapy) se předpočítají po importu do `site_cache` (`src/lib/snapshots.ts`, `src/lib/sitemap.ts`). Tematické filtry (děti, aquapark, pláž) používají příznak `hotels.theme_flags` spočítaný při importu, ne LIKE přes popisy.
- D1 limity ošetřené v kódu: max 100 vázaných parametrů na dotaz (konstanty se vkládají jako literály, ne jako parametry), max hloubka výrazu 100 (žádné dlouhé řetězy OR).
- Bez KV, Queues, Durable Objects, Workflows: nebyly potřeba.
- Čedok (SFTP 3,4 GB) zůstává na Malině (`scripts/kakapo/cedok-slim-feed.py`), slim feed nahrává do R2.

Moduly: `src/lib/{helpers,search,snapshots,sitemap,themes,dispatch}.ts`, `src/lib/landing/*` (kontexty a texty landingů), `src/lib/listing/*` (výpisy, home), `src/lib/hotel/*`, `src/lib/products/*`, `workers/import/*`.
