# Administrace (bez WordPressu)

Adresa `/admin/`, vždy za Cloudflare Access. Každá stránka i endpoint ověřují JWT sami (`src/lib/admin/guard.ts`, fail closed): bez `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` je admin zavřený (503), bez/špatný JWT 401/403. Lokální bypass jen při `ENVIRONMENT=local|test` a `ADMIN_DEV_BYPASS=1`. Zápisy: POST formuláře na `/api/admin/*` se stejným původem (Origin), CSRF tokenem (HMAC s `CSRF_SECRET`) a rate limitem `RL_ADMIN`; každá změna jde do `admin_audit`.

| Stránka | Co umí |
|---|---|
| `/admin/` | přehled feedů: stav, poslední úspěšný běh, poslední běh (načteno/nové/změněné/odmítnuté/vyřazené), počet chyb; **Spustit**, **Pozastavit**, **Zapnout**; počty aktivních nabídek, hotelů, produktů |
| `/admin/hotely/` | hledání hotelu (název/slug), skrytí/zveřejnění (`hotels.hidden`, s povinným důvodem), výpis nabídek hotelu, nabídka podle ID → skrýt/zrušit blokaci |
| `/admin/texty/` | `editorial_overrides`: h1, title (max. 60 znaků), description, intro, seo_text, faqs_json, robots, canonical; typy landing/hotel/product/page |
| `/admin/presmerovani/` | `redirects` 301/302/308/410, odmítá smyčky, řetězce, vyhrazené cesty, cizí domény, parametry |
| `/admin/audit/` | posledních 200 změn |

## Kontrakty s ostatními částmi
- **Import Worker (binding `IMPORTER`):** admin volá `POST https://importer.internal/run` s `Authorization: Bearer ${IMPORT_SHARED_SECRET}` a tělem `{"feed_id": N}`; očekává 2xx. Pozastavení = `feeds.enabled = 0`, import musí takový feed přeskočit.
- **Skrytá nabídka:** `hideOffer` nastaví `offers.active = 0` a zapíše `(feed_id, external_id)` do `offer_blocklist` (migrace `0003_offer_blocklist.sql`). **Importér musí blocklist respektovat** (nepřidávat/neaktivovat), jinak by nabídku další běh vrátil.
- **Renderer webu:** hotely s `hidden = 1` a nabídky mimo `active = 1` nezobrazovat; `editorial_overrides` číst přednostně před generovanými texty (pole `faqs_json` = `[{"q","a"}]`); `redirects` aplikovat v middleware (status 410 = Gone, prázdný `to_path`).

## Proměnné a secrety
`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `CSRF_SECRET`, `IP_HASH_SALT`, `IMPORT_SHARED_SECRET`, volitelně `GO_ALLOWED_HOSTS`. Staging i produkci je potřeba chránit Access aplikací i na workers.dev aliasu.
