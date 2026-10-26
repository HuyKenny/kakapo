# Nasazení

## Prostředí
| | local | staging | production |
|---|---|---|---|
| Web Worker | `wrangler dev` (`dist/server/wrangler.json`) | `kakapo-staging` na workers.dev, za Access | `kakapo`, routes `kakapo.cz/*` |
| Import Worker | — | `kakapo-import-staging` (bez cronu) | `kakapo-import` (cron */10, 01:30) |
| D1 | lokální SQLite (`.wrangler/state`) | `kakapo-staging` | `kakapo-production` |
| R2 | lokální | `kakapo-snapshots-staging` | `kakapo-snapshots` |

Secrets (nikdy v Gitu): `credentials/.kakapo-credentials.env` (`ACCESS_AUD_*`, `IP_HASH_SALT_*`, `IMPORT_SHARED_SECRET_*`, `CF_ACCOUNT_ID`), feed URL a CJ tokeny do import Workeru přes `scripts/set-feed-secrets.py <env>` (vypíše jen počet a hosty).

## Staging (`pnpm tsx scripts/deploy.ts --env staging [--secrets]`)
1. záloha D1, 2. migrace `migrations/*.sql`, 3. import Worker, 4. build (`CLOUDFLARE_ENV=staging`, `BUILD_ID`=git sha), `verify-no-secrets`, 5. web Worker, 6. smoke test přes Access service token.
Data: `scripts/migrate-from-wp.ts` → SQL (`tmp/kakapo-sql`) → `wrangler d1 execute --remote --file`.

## Produkce – kroky přepnutí (každý krok ověřit, než se pokračuje)
1. Čerstvý export z WP (`scripts/export-from-wp.ts`) a záloha WP (FTP + DB) – hotovo 26. 10., opakovat těsně před přepnutím.
2. Vytvořit `kakapo-production` D1 + R2, doplnit `production` env do `wrangler.jsonc` a `workers/import/wrangler.jsonc`.
3. Načíst data (finální synchronizace), `set-feed-secrets.py production`, první import ručně (HTTP API), srovnat počty se staré verzí.
4. Zastavit WP importy (Malina: cron tick `kakapo`, Čedok skript přepnout na `PUT /feeds/41/snapshot`), nechat jen nové.
5. `KAKAPO_PRODUCTION_APPROVED=yes pnpm tsx scripts/deploy.ts --env production --secrets` – Worker bez routy.
6. Přidat route `kakapo.cz/*` na Worker (Workers route v zóně; `go-worker` route `kakapo.cz/go/*` odstranit až po ověření `/go/`). DNS záznamy a pošta se nemění.
7. Kontroly: `scripts/seo-parity.py`, `/go/` per partner, sitemapy, GA4 Realtime, purge Cloudflare cache zóny (WEDOS HTML cache už nebude potřeba).
8. Monitoring: `bin/kakapo-health.py` (přepsat na D1/`/admin`), 24 h sledování 5xx.
Před zrušením hostingu ověřit schránky/formuláře/jiné weby na pool 89.221.213.39 (18 webů). WordPress a zálohy se nemažou, dobu uchování schvaluje Kenny.


## Provoz od 26. 10. 2026 (bez WordPressu)
- Importy: Cloudflare Cron Trigger `kakapo-import` (*/10, denní údržba 01:30 UTC). Staging bez cronu.
- Čedok: Malina crontab 2:30 `cedok-slim-feed.py --target r2` (`bin/kakapo-crontab-update.sh` provede úpravu crontabu).
- Hlídač: cron-job.org „kakapo.cz health (30 min)" → `https://kakapo.cz/api/health/` (e-mail po 5 selháních).
- IndexNow: import Worker po přestavbě sitemap (1× za ~20 h), klíč `/<INDEXNOW_KEY>.txt` v `public/`.
- Sitemapy: import Worker (`rebuildSitemaps`), ručně `npx tsx scripts/build-sitemaps.ts production`.
- Nasazení webu: `CLOUDFLARE_ENV=production BUILD_ID=$(git rev-parse --short HEAD) SITE_URL=https://kakapo.cz npx astro build && npx tsx scripts/verify-no-secrets.ts && npx wrangler deploy -c dist/server/wrangler.json`.
- Zóna kakapo.cz: WP cache pravidla smazána, `browser_cache_ttl` = respektovat hlavičky, TLS 1.3, Brotli; A záznamy na WEDOS IP zůstávají jen jako kotva pro Workers routy.
