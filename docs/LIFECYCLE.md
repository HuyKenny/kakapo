# Hotel lifecycle, feed parity, new hotels

## Rules
| Event | What happens | Where |
|---|---|---|
| New hotel in a feed | created at import (`INSERT OR IGNORE` by `dedup_key`); indexable once it has ≥ 200 chars of text or a photo | `engine/hotels.ts` |
| Offer disappears from a full feed | deactivated at the end of the run (guard: > 35 % missing → run held as `suspicious`) | `engine/run.ts` finalize |
| Price / date / nights change | row updated via `content_hash`, `price_changed_at` set | `engine/offers.ts` |
| Departure in the past | offer deactivated daily | `engine/daily.ts` |
| Feed older than interval + 24 h | its offers leave the sale (`offers/eligibility.ts`) and `/api/health` alerts | `api/health.ts` |
| Hotel without offers for **60 days** (`HOTEL_RETIRE_DAYS`) | **retired**: 301 `/hotel/<slug>/` → destination → country → `/zajezdy/` (each only if it has ≥ 12 live hotels), `hotels.retired_at` set, removed from the sitemap | `engine/lifecycle.ts`, daily job |
| Hotel days 0–60 without offers | stays 200 as "sold out" with alternatives, indexable | `lib/hotel` (`HOTEL_GRACE_DAYS` = retire days) |
| Offer returns for a retired hotel | redirect deleted, `retired_at` cleared – in the finalize of the feed that brought it back | `engine/run.ts` |

Rows are never deleted: the slug and `dedup_key` stay reserved, so a returning hotel is not duplicated and a retired URL can never shadow a new page. Manual / merge redirects are never overwritten (`reason` ≠ `retired`).

## Parity (database = last successful feed)
After every complete feed run (`engine/parity.ts`): count check (active rows vs. feed items vs. rejected) and a field-by-field sample of ~100 offers (price, departure, nights). A finding does not block the run: the run message starts with `PARITY:` and `/api/health` returns 503 with the reason (monitored by cron-job.org). Not covered: the partner's own website (prices there cannot be verified automatically).

`/api/health` also reports: overdue feed, feed held by the size guard, live/retired hotel counts.

## Operating
- Daily (01:30 UTC cron) retires and reactivates automatically.
- Manual: `POST <import worker>/retire?dry=1` (counts by redirect target + sample), `POST …/retire` (do it), `?limit=N` caps one run. Bearer `IMPORT_SHARED_SECRET`.
- Rollback: `DELETE FROM redirects WHERE reason = 'retired'; UPDATE hotels SET retired_at = NULL;`
- Image warm-up: the Worker no longer warms (`WARM_ENABLED=0`, wsrv.nl blocks Cloudflare egress with 403); `bin/kakapo-warm-pi.py` runs on Malina (cron 05:00). Dead photos are never removed automatically (a 404 from wsrv.nl does not prove the origin photo is gone).
