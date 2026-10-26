# Rollback

Spouštěcí podmínky: 5xx > 2 % po dobu 10 min, `/go/` nevrací 302 pro nějakého partnera, import zastavil katalog (prázdné výpisy), pokles impresí v GSC > 20 % po týdnu bez vysvětlení, ztráta měření GA4.

1. **Směrování** (okamžitě, bez změny DNS): také znovu zapnout zónové cache pravidlo „Edge-cache HTML pages…“ (vypnuto 26. 10., záloha `backups/kakapo-cf-cache-rules-2026-10-26.json`), jinak WordPress poběží bez edge cache; odebrat Workers route `kakapo.cz/*` (a znovu zapnout `go-worker` route `kakapo.cz/go/*`). Provoz jde zpět na WEDOS WordPress, který zůstává nedotčený.
2. **Importy**: vypnout cron nového import Workeru (`wrangler triggers`/odebrat cron) a znovu spustit WP tick na Malině (`kakapo` cron). Nikdy neběžet oba současně.
3. **Kód**: předchozí verze Workeru `wrangler rollback --env production` (web i import). Návrat kódu NENÍ návrat dat.
4. **Data**: D1 se obnovuje ze zálohy `backups/d1-production-*.sql` (`wrangler d1 execute --file`) nebo znovu migrací ze zálohy WP exportu. Kompatibilní schéma zajišťují migrace (jen přidávají sloupce/tabulky).
5. **Změny po přepnutí**: kliky (`clicks`) a audit (`admin_audit`) vznikají jen v D1; před návratem je exportovat (`wrangler d1 export`). Ruční úpravy textů/přesměrování z adminu jsou v `editorial_overrides`/`redirects` – promítnout do WP (`/maintenance/landing-texts`).
6. Po návratu: purge Cloudflare cache zóny, ověřit `/`, `/zajezdy/`, `/hotel/…`, `/go/…`.
