# Mapování dat WordPress → D1

Zdroj: `wp_kakapo_*` (plugin kakapo-travel-engine v2.2.4; žádné CPT, žádný WooCommerce). Export: `scripts/export-from-wp.ts` (read-only endpoint `/wp-json/kakapo/v1/maintenance/export`, 26. 10. 2026, záloha `backups/kakapo-wp-export-2026-10-26/`). Převod: `scripts/migrate-from-wp.ts` → SQL → D1.

| WP | D1 | Poznámka |
|---|---|---|
| `hotels` (22 030) | `hotels` | stejné `id` a `slug`; `images`/`amenities` → `images_json`/`amenities_json`; nový `hidden`, `theme_flags` |
| `offers` (94 806, aktivních 22 741) | `offers` | jen aktivní; stejné `id` (kvůli /go/{id}); nový `content_hash`, `price_basis`, `seen_run` |
| `products` (3 100) | `products` | stejné `id`/`slug`; `meta` → `meta_json`; `search_text` pro hledání bez diakritiky |
| `price_history` (1,21 mil.) | `price_history` | posledních 180 dní |
| `feeds` (41) | `feeds`, `partners` | URL feedů jsou secrets `FEED_URL_<id>`, ne v DB |
| `import_logs` (1 813) | — | historie se nepřenáší; nové běhy v `import_runs`/`import_errors` |
| `hotel_aliases` (60) | `hotel_aliases` | |
| option `kakapo_landing_texts` (234 cest, 1 391 polí) | `editorial_overrides` (kind=`landing`) | ruční texty import nepřepíše |
| option `kakapo_hotel_redirects` (60) | `redirects` | 301 `/hotel/{old}/` → `/hotel/{new}/` |
| `clicks` (650 tis.) | `clicks` (prázdná) | historie se nepřenáší (z velké části boti); záloha exportu obsahuje jen počet |
| Rank Math redirecty | — | jen odpad po skenerech botů, nepřenášejí se |
| `reviews` | — | tabulka je prázdná |

Ceny: celé koruny (INTEGER) + `currency`; žádný float. Identita nabídky: `UNIQUE (feed_id, external_id)`. Hotely se neslučují podle podobnosti (jen `dedup_key`, GIATA a ruční aliasy).
Report počtů: `tmp/kakapo-sql/_report.json` (0 odmítnutých řádků při migraci 26. 10.).
