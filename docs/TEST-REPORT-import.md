# Test report — import Worker (26. 10. 2026)

Spuštěno: `npx vitest run tests/import` (Node 22.23, vitest 4.1.11, `node:sqlite` jako náhrada D1 nad skutečnými migracemi 0001+0002, R2 v paměti, `fetch` mock). Typová kontrola: `npx tsc -p workers/import/tsconfig.json` bez chyb.

**Výsledek: 4 soubory, 72 testů, všechny prošly.**

> Co tyto testy NEdokazují: běh v runtime workerd (Cloudflare), skutečný D1 (latence, účtované řádky), skutečné feedy partnerů. Test v `@cloudflare/vitest-pool-workers` a staging běh jsou otevřené (viz FEED-IMPORTS.md, sekce Nezkoušeno).

## Výpis testů
```
✓ tests/import/adapters.test.ts > CJ per-partner parsers > atcom (Fischer/Exim): country, destination, city, giata, meal, nights, dates from the URL
✓ tests/import/adapters.test.ts > CJ per-partner parsers > bluestyle: rating from customLabel1, date, duration and meal from room1
✓ tests/import/adapters.test.ts > CJ per-partner parsers > tui: airport, dates and nights from the offer code
✓ tests/import/adapters.test.ts > CJ per-partner parsers > sale price wins and the list price becomes the original price; deleted / dateless / priceless products are dropped
✓ tests/import/adapters.test.ts > CJ per-partner parsers > spa products: city, nights and type from the title
✓ tests/import/adapters.test.ts > CJ per-partner parsers > GraphQL query only accepts numeric ids (no injection through the feed config)
✓ tests/import/adapters.test.ts > CJ per-partner parsers > end to end: CJ feed pages through the API, imports hotels and offers; the token never leaves the Authorization header
✓ tests/import/engine.test.ts > first import and repeat > imports hotels and offers, computes aggregates and reports counters
✓ tests/import/adapters.test.ts > CJ per-partner parsers > CJ without secrets fails with a clear message and touches nothing
✓ tests/import/adapters.test.ts > HTTP download policy > allow-list matching
✓ tests/import/adapters.test.ts > HTTP download policy > rejects plain http, IP literals and hosts outside the list
✓ tests/import/adapters.test.ts > HTTP download policy > follows redirects only to allowed hosts (SSRF through a redirect is blocked)
✓ tests/import/adapters.test.ts > HTTP download policy > retries 5xx / 429 but not 4xx
✓ tests/import/adapters.test.ts > HTTP download policy > affiliate url builder: params, {url} templates and untouched tracking links
✓ tests/import/adapters.test.ts > product feeds > variants of one tour merge into one product with dated terms and the lowest price
✓ tests/import/adapters.test.ts > product feeds > a product that disappears from a complete feed is deactivated; a rejected one keeps its row
✓ tests/import/adapters.test.ts > product feeds > categorisation rules
✓ tests/import/adapters.test.ts > Čedok slim feed through R2 > imports an uploaded snapshot; the same snapshot is a no-op; a new upload runs ahead of the night window
✓ tests/import/engine.test.ts > first import and repeat > repeating the same feed changes nothing and writes no offer rows
✓ tests/import/adapters.test.ts > admin API > rejects missing or wrong credentials and a weak secret
✓ tests/import/adapters.test.ts > admin API > status, run, pause/resume with an audit trail
✓ tests/import/adapters.test.ts > admin API > upload endpoint validates size
✓ tests/import/engine.test.ts > first import and repeat > a price change updates one offer, keeps the previous price and refreshes the hotel minimum
✓ tests/import/adapters.test.ts > daily maintenance and scheduling > expires departed offers, slides the last-minute window, snapshots prices once a day and computes drops
✓ tests/import/adapters.test.ts > daily maintenance and scheduling > window parsing and next run times respect DST
✓ tests/import/adapters.test.ts > real feed configuration from the WordPress export > every exported feed maps to a registered adapter with a usable mapping
✓ tests/import/adapters.test.ts > real feed configuration from the WordPress export > the real Invia hotel mapping (flat feed, hashed ids, nights from days) imports a synthetic Invia document
✓ tests/import/engine.test.ts > first import and repeat > a new offer is added and a vanished one is deactivated (complete feed)
✓ tests/import/engine.test.ts > broken, empty and unavailable feeds never touch the catalogue > empty body
✓ tests/import/engine.test.ts > broken, empty and unavailable feeds never touch the catalogue > valid XML without items
✓ tests/import/engine.test.ts > broken, empty and unavailable feeds never touch the catalogue > truncated XML
✓ tests/import/engine.test.ts > broken, empty and unavailable feeds never touch the catalogue > malformed XML
✓ tests/import/engine.test.ts > broken, empty and unavailable feeds never touch the catalogue > wrong encoding
✓ tests/import/engine.test.ts > broken, empty and unavailable feeds never touch the catalogue > HTML error page served with 200
✓ tests/import/xml-stream.test.ts > streaming XML parser > emits items with attributes, entities, CDATA, namespaces and self-closing tags
✓ tests/import/xml-stream.test.ts > streaming XML parser > gives the same result for any chunk size (tags, CDATA and entities split across chunks)
✓ tests/import/xml-stream.test.ts > streaming XML parser > rejects a truncated document
✓ tests/import/xml-stream.test.ts > streaming XML parser > rejects mismatched tags as malformed
✓ tests/import/xml-stream.test.ts > streaming XML parser > rejects empty input
✓ tests/import/xml-stream.test.ts > streaming XML parser > refuses DOCTYPE with entities (XXE / billion laughs)
✓ tests/import/xml-stream.test.ts > streaming XML parser > does not decode unknown entities and keeps numeric ones
✓ tests/import/xml-stream.test.ts > streaming XML parser > enforces depth, item size and node-count limits
✓ tests/import/xml-stream.test.ts > streaming XML parser > does not keep memory for content outside items (only item trees are built)
✓ tests/import/xml-stream.test.ts > byte decoding > reads plain UTF-8
✓ tests/import/xml-stream.test.ts > byte decoding > detects and unzips gzip by magic bytes
✓ tests/import/xml-stream.test.ts > byte decoding > honours the declared encoding (windows-1250)
✓ tests/import/xml-stream.test.ts > byte decoding > fails on invalid bytes for the declared encoding instead of importing mojibake
✓ tests/import/xml-stream.test.ts > byte decoding > fails on an empty body
✓ tests/import/xml-stream.test.ts > byte decoding > caps the decompressed size (gzip bomb)
✓ tests/import/xml-stream.test.ts > byte decoding > md5 matches the PHP hash used for Invia ids
✓ tests/import/xml-stream.test.ts > byte decoding > parses dates like the PHP transforms
✓ tests/import/engine.test.ts > broken, empty and unavailable feeds never touch the catalogue > partner unavailable: bounded retries with exponential backoff, then failure
✓ tests/import/engine.test.ts > broken, empty and unavailable feeds never touch the catalogue > a failed run schedules a retry and does not mark the feed as successfully imported
✓ tests/import/engine.test.ts > broken, empty and unavailable feeds never touch the catalogue > mostly invalid records are treated as a broken mapping, not as a catalogue to import
✓ tests/import/engine.test.ts > conditional requests > 304 is a successful no-op, never an empty catalogue
✓ tests/import/engine.test.ts > suspicious drops and incremental feeds > a feed that suddenly shrinks by more than the limit is parked, not applied; approval applies it
✓ tests/import/engine.test.ts > suspicious drops and incremental feeds > many ids vanishing while the size looks normal is also held (ratio guard), then approved
✓ tests/import/engine.test.ts > suspicious drops and incremental feeds > an incremental feed never deactivates what it does not list
✓ tests/import/engine.test.ts > suspicious drops and incremental feeds > a record that fails validation keeps its previous offer alive (parse error != removal)
✓ tests/import/engine.test.ts > suspicious drops and incremental feeds > past departures are skipped and their offers expire
✓ tests/import/engine.test.ts > interruption, resume and duplicate delivery > a run interrupted between blocks resumes from its checkpoint and ends identical to an uninterrupted one
✓ tests/import/engine.test.ts > interruption, resume and duplicate delivery > re-applying an already applied block (duplicate delivery) is idempotent
✓ tests/import/engine.test.ts > interruption, resume and duplicate delivery > an older run cannot overwrite data written by a newer run
✓ tests/import/engine.test.ts > interruption, resume and duplicate delivery > two concurrent importers of the same feed: the second one is refused by the lock
✓ tests/import/engine.test.ts > interruption, resume and duplicate delivery > a run that lost ownership (feed.current_run changed) stops without writing
✓ tests/import/engine.test.ts > catalogue rules > the same hotel from two partners becomes one hotel with two offers; richer data is not overwritten
✓ tests/import/engine.test.ts > catalogue rules > an editorial description (description_source = kakapo) is never replaced by a feed text
✓ tests/import/engine.test.ts > catalogue rules > manual alias keeps pointing a feed name to the merged hotel (no duplicate is created)
✓ tests/import/engine.test.ts > catalogue rules > the same partner offer arriving through another feed replaces the old row (no duplicate offers)
✓ tests/import/engine.test.ts > catalogue rules > feed URLs and tokens never appear in logs, run messages or errors
✓ tests/import/engine.test.ts > catalogue rules > the import window and manual runs are respected by the tick
✓ tests/import/scale.test.ts > catalogue scale > 22 700 offers: first import, identical repeat, and a 5 % price-change run
```

## Měření v měřítku katalogu (`tests/import/scale.test.ts`)
Syntetický úplný feed, 22 700 hotelů × 1 nabídka (odpovídá ~22 741 aktivním nabídkám produkce). Čas je z Node + node:sqlite, **není to čas ve Workeru ani v D1**.

| běh | čas | připravených SQL příkazů | zapsaných řádků (náš počet) | poznámka |
|---|---|---|---|---|
| první import | 10.0 s | 70728 | 68100 | 22700 nových nabídek + hotely |
| stejný feed znovu | 4.7 s | 2287 | **0** | 22700 beze změny, žádný zápis nabídek |
| 5 % změn ceny | 6.2 s | 4557 | 2270 | 1135 změněno (+ stejný počet hotelů s novým min. cenou) |

Velikost SQLite souboru po prvním importu: 22.7 MB (bez historie cen a bez obrázků hotelů z produkce).

Závěr z měření: opakovaný import nezapíše nic; zápisy rostou jen s počtem skutečných změn. Počet *přečtených* řádků D1 jsme neměřili (node:sqlite je nepočítá) — odhad a postup měření je v FEED-IMPORTS.md.

## Opravené chyby nalezené testy
1. `isYmd` přijímal neexistující datum `2026-02-31` (Date.parse ho normalizuje) → nyní kontrola round-trip.
2. Selhání před vytvořením záznamu běhu (prázdné tělo, 5xx, nedostupný partner) nechávalo `import_runs.status = running` a `feeds.current_run` nastavený → záznam běhu se nyní zakládá před stahováním.
3. Schválení „suspicious" běhu narazilo na stejnou pojistku podruhé → schválení pojistky zvedá.
