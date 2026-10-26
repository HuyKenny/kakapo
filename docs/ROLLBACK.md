# Rollback (od 26. 10. 2026 bez WordPressu)

WordPress byl na Kennyho pokyn odstraněn („k WordPressu se už nikdy nevrátím"). Finální záloha: `backups/kakapo-wp-final-db-2026-10-26.sql.gz` (celá DB `d196468_kakapo`) a `backups/kakapo-wp-final-files-2026-10-26.zip` (soubory z WEDOS). Návrat se proto dělá jen v rámci nové aplikace.

Spouštěcí podmínky: 5xx > 2 % 10 min, `/api/health` 503 déle než 2 h, `/go/` nevrací 302 na partnera, prázdné výpisy.

1. **Kód webu:** `wrangler rollback -c dist/server/wrangler.json` (předchozí verze Workeru `kakapo`), resp. `wrangler versions list` + `wrangler rollback <id>`.
2. **Importér:** `wrangler rollback` s `-c workers/import/wrangler.jsonc --env production`; pozastavit konkrétní feed přes `POST /feeds/:id/pause` (bearer `IMPORT_SHARED_SECRET_PRODUCTION`) nebo v `/admin/`.
3. **Data:** D1 Time Travel (obnova do bodu v čase za posledních 30 dní, zdarma): `wrangler d1 time-travel restore kakapo-production --timestamp <ISO>`; nebo SQL export `wrangler d1 export DB --remote --env production`. Návrat kódu NENÍ návrat dat.
4. **Feed rozbil katalog:** podezřelé poklesy se samy zastaví (`suspicious`), schválení `POST /feeds/:id/approve`; jinak obnova D1 přes Time Travel (bod 3).
5. Po zásahu: `scripts/seo-parity.py` proti vzorku URL a kontrola `/api/health`.
