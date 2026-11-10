# Feed imports (Import Worker)

> **Od 10. 11. 2026:** slim feedy ATIS a Čedok generuje veřejné repo [`HuyKenny/kakapo-feeds`](https://github.com/HuyKenny/kakapo-feeds) v GitHub Actions (2:10 a 2:30 CET). Cesty `~/ai/scripts/kakapo/*-slim-feed.py` a cron na Malině níže jsou historické.


Code: `workers/import/src`, tests: `tests/import`, schema: `migrations/0001_init.sql` + `0002_import.sql`, results: `docs/TEST-REPORT-import.md`.
Status 26. 10. 2026: **implemented and unit/integration tested on node:sqlite; not yet run in workerd, on a real D1, or against live partner feeds.**

## Flow of one feed
```
cron */10 (tick)  ──►  stepFeed(feed)
  lock (feeds.lock_until, 20 min, refreshed per block)
  1. download + normalise   (atomic; any failure = nothing applied)
       http | cj | r2 source ► streaming parse ► adapter mapping ► zod model ► NDJSON blocks (200 records) + manifest in R2
       gates: 0 valid items ⇒ failed · >50 % invalid ⇒ failed (mapping/format changed) · size drop > MAX_DROP_PCT ⇒ 'suspicious' (parked)
  2. apply blocks           (resumable: import_runs.checkpoint_json = {next block, counters}; idempotent via content_hash)
       hotels (GIATA → alias → dedup_key) ► offers/products: 1 lookup per ≤80 ids ► INSERT new / UPDATE changed / nothing for unchanged
  3. finalize
       complete feed only: deactivate offers missing from the manifest (ratio guard) ► recompute hotel aggregates (changed hotels only)
       last_success_* / etag / next_run_at written ONLY here; old snapshots pruned (this + previous good run kept)
after every successful run: rebuildSnapshots (registry/facets, bumps data_version) + rebuildSitemaps at most once per 20 h (site_cache 'sitemap:index'), SITE_URL from vars; failures are logged, never fail the run
  hotel aggregates also store hotels.theme_flags (computeThemeFlags: name/description/amenities + up to 40 active offer titles/rooms), written only when changed
cron 30 1 * * *   ►  runDaily (expire departures, slide last/first-minute flags, price_history snapshot, drops, retention)
```
One invocation has a wall budget (9 min, `Deps.budgetMs`); an unfinished run returns `continue` and the next tick resumes at the next block. Download/normalise is **not** resumable on purpose (no parser restart from an arbitrary byte of a gzip stream): an interrupted download restarts from scratch and the abandoned run is marked `aborted`.

## Adapters
| adapter name | feeds (WP ids) | source | notes |
|---|---|---|---|
| `cj-atcom` | Fischer (1), Exim (2) | CJ GraphQL | termín, noci, strava, GIATA z URL zájezdu |
| `cj-bluestyle` | Blue Style (3) | CJ GraphQL | hodnocení z `customLabel1`, `room1=2\|SR\|BB` |
| `cj-tui` | TUI (4) | CJ GraphQL | letiště/termíny/noci z `OfferCodeWS` |
| `cj-generic` | Spa.cz (12, products, parser `spa`) | CJ GraphQL | wellness produkty |
| `xml-invia_offer` / `xml-invia_hotels` | 7, 13–31 | https | ids = md5(url)[0:24] jako v PHP; ids se mění při každém běhu ⇒ `rotatingIds` (ratio guard vypnutý, platí size guard) |
| `xml-sdovolena_hotels` / `xml-sdovolena_tours` | 32, 5, 6, 8 | https | |
| `xml-slevomat_deals` | 9 | https | filtr kategorie „Plavba lodí" |
| `xml-zbozi_product` | 10, 11 | https | Excursia/Zážitky, `excursia_img` transform |
| `xml-adrop_pobyty` | 33 | https | |
| `xml-dovolena_hotels` / `xml-dovolena_products` | 34–40 | https | |
| `cedok-slim` | Čedok (41) | **R2 inbox** | Malina nahraje slim feed `PUT /feeds/41/snapshot`; stejný etag ⇒ `not_modified` |

XML adapters share one declarative mapper (`xml/mapper.ts`: `path`/`paths`, `multiple`, `aggregate`, whitelisted transforms, no eval) driven by `feeds.mapping_json`, copied from the WP export by `workers/import/scripts/feeds-config-sql.ts` (presets in `xml/presets.json` are only a fallback). Every adapter output passes `adapters/normalize.ts` → `model.ts` (zod); invalid records are counted per reason in `import_errors` (first 100 per run) and never silently dropped.

## Safety rules (and the test that proves each)
| rule | where | test |
|---|---|---|
| empty / truncated / malformed / mis-encoded XML never changes the catalogue | download phase is atomic | `engine.test.ts › broken, empty and unavailable feeds…` |
| 304 or identical snapshot is a no-op, not an empty catalogue | `openFeed` returns `notModified` | `conditional requests`, `Čedok slim feed through R2` |
| shrinking feed is parked (size guard) and many vanished ids are parked (ratio guard); admin approves via `POST /feeds/:id/approve` | `startRun` / finalize | `suspicious drops and incremental feeds` |
| incremental feed (`is_full_catalogue=0`) never deactivates | finalize | same |
| a record that fails validation does not remove its offer | manifest keeps rejected-but-identifiable ids | same |
| one importer per feed; lost ownership stops the run; older run cannot overwrite newer data (`seen_run <= run`) | lock + `current_run` check + guarded UPDATE | `interruption, resume and duplicate delivery` |
| repeating a block / the whole feed writes nothing | content hash, no `last_seen` churn | same + `scale.test.ts` (repeat ⇒ 0 rows) |
| only https, allow-listed hosts, also for redirects; no IPs / private ranges; retry only 5xx/429/network, backoff 1 s, 2 s | `adapters/http.ts` | `HTTP download policy` |
| decompression bomb, deep nesting, huge item, DOCTYPE/entities | `xml/stream.ts` limits | `xml-stream.test.ts` |
| feed URLs and tokens are never logged or put into messages | secrets only in env; errors are generic | `feed URLs and tokens never appear…`, CJ test |
| editorial text (`description_source='kakapo'`) and manual hotel aliases survive imports | `enrichPatch`, alias lookup | `catalogue rules` |

## Secrets and configuration (names only)
Worker secrets: `IMPORT_SHARED_SECRET` (≥ 24 znaků), `CJ_API_TOKEN`, `CJ_CID`, `CJ_PID`, `FEED_URL_<feed id>` for 35 http feeds (list printed by `feeds-config-sql.ts`; URLs are not in the WP export on purpose).
Vars (`workers/import/wrangler.jsonc`): `ALLOWED_FEED_HOSTS` (**placeholder list, must be checked against the real partner hosts before the first run**), `IMPORT_WINDOW` (`0-7`, Prague hours; same rule as the WP scheduler: once per `max(1, floor(interval/24))` days at window start; manual runs and Čedok uploads ignore the window), `MAX_DROP_PCT`, `LAST_MINUTE_DAYS`, `FIRST_MINUTE_DAYS`.

## HTTP API (service binding / Malina; `Authorization: Bearer <IMPORT_SHARED_SECRET>`)
`GET /status` · `POST /feeds/:id/run[?now=1]` · `POST /feeds/:id/pause|resume|approve` · `PUT /feeds/:id/snapshot` (≤ 150 MB, content-length required) · `POST /daily`. Mutations are written to `admin_audit`.

## Differences from the WordPress importer (deliberate)
* No per-item SELECT/`last_seen` write; presence in a complete feed is decided from the run manifest.
* Deactivation after the **whole** feed is applied and only below the guards; the PHP version deactivated in batches after parsing without any guard.
* Download is validated before anything is written (PHP wrote while parsing).
* `price_basis` column (`person|room|booking`) added; all current feeds are `person`.
* Timestamps written by the Worker are UTC `YYYY-MM-DD HH:MM:SS`; rows migrated from WP carry the old WP-local strings (Prague time). Departure dates and "today" are always Europe/Prague dates.
* Hotel aggregates: `airports_csv` no longer contains an empty element; `offers_last_seen` is refreshed at most once a day.
* `content_hash` is a new 28-hex hash; migrated offers carry the 16-hex hash from `migrate-from-wp.ts`, so **the first import after cut-over rewrites every offer once** (≈ 22 700 rows) — expected, harmless.
* Offer `id` is `INTEGER PRIMARY KEY` (no AUTOINCREMENT): after deleting the newest row its id can be reused. `/go/{id}` must treat an unknown or changed offer gracefully (redirect to the hotel page), as the WP version did.

## Not done / not verified
* **Slevomat enricher** (`class-slevomat-enricher.php`: texts, ratings, photos from the full Slevomat feed) is **not ported**; hotels from feed 32 keep their feed photos/texts until it is.
* `Kakapo_Product_Repository::pool_gallery_batch` (Excursia gallery pooling) not ported; `gallery_enriched` is preserved if present.
* Hotel-merge tooling (`class-hotel-merge.php`) and image pruning are admin jobs, not importer logic — not part of this Worker.
* Čedok upload: `scripts/kakapo/cedok-slim-feed.py` still uploads via FTP to the WP host; it has to `PUT` the slim feed to `/feeds/41/snapshot` instead (outside this change).
* Not run: workerd runtime, real D1 (batch/transaction limits, rows read/written billing), real partner feeds and real CJ API, memory/CPU of a 140 MB Slevomat XML inside a Worker (parser is streaming, but the limit has **not** been measured here). Current Cloudflare limits (CPU, subrequests, D1 params/batch size, request body size) were not re-verified against the official documentation in this change; values used (80 bound params, 50 statements per batch, 150 MB upload) are conservative assumptions — check before staging.
* D1 rows **read** per run are not measured. Estimate from the code per 22.7k-offer full feed: ~(hotels 3 lookups + offers 1 lookup)/200 records ⇒ a few thousand rows plus the aggregate pass (every active offer of the feed's hotels once) ≈ 25–50 k rows read, ~2 k statements; measure on staging with `meta.rows_read`.
