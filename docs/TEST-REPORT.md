# Test report (26. 10. 2026)

## Automatické testy (`npx vitest run`, Node, node:sqlite jako D1)
232 testů, 11 souborů, vše prošlo: import (80), go + admin (81), landingy (21), hotel (15), výpisy (16), produkty (19). Podrobnosti: `TEST-REPORT-import.md`, `TEST-REPORT-go-admin.md`. Omezení: testy neběží ve workerd.

## Oracle proti živému webu (shoda title, H1, description, canonical, robots, H2, FAQ)
landingy 24/24, hotely 16/16, výpisy+home 9/9 (nad exportem z 26. 10.).

## Paritní test staging × živý web (`scripts/seo-parity.py`, 3 676 URL ze živých sitemap, 26. 10. odpoledne)
- Stejný status: 3 646 / 3 676. Rozdíly: 30 URL (landingy destinací s jediným hotelem: 200 vs 404, příčina `LIMIT 500` v registry → opraveno na 3 000, ověřit po dalším importu).
- Opraveno po testu: chybějící JSON-LD `Organization` (Rank Math ho vydával na všech stránkách).
- Zbylé rozdíly jsou datové (staging už importoval čerstvější nabídky než export: počty hotelů/ceny v description, názvy destinací „Káhira"/„Kahira"), ne rozdíl v kódu.
- `robots` na stagingu je `noindex,nofollow` záměrně (mimo produkci).

## Skutečný běh na Cloudflare (staging)
- Načtení dat: počty v D1 = zdroj (22 030 hotelů, 22 741 aktivních nabídek, 3 100 produktů, 1,21 mil. historie cen, 1 391 textů, 60 přesměrování).
- **Nalezené a opravené v reálné D1 (lokální SQLite je neukázalo):** (1) limit 100 vázaných parametrů, (2) hloubka výrazu 100 u dlouhých OR, (3) EXISTS nad `offers` volil špatný index a četl ~4 mil. řádků/12 s → `INDEXED BY idx_offers_hotel` (13 ms, 2,4 tis. řádků), (4) 160 dotazů na landing → ~20 (dávky `db.batch`, předpočítané bloky v `site_cache`). Studený landing: z >100 s na 1–2,5 s, teplý ~0,2–1 s.
- Importy skutečných feedů (CJ API, Slevomat, Excursia, Zážitky, Rady na cestu, Invia, Dovolena.cz, Čedok přes R2): CJ Fischer 3 087 položek, Exim 2 668, TUI 1 289, Blue Style 79, Čedok 3 277 hotelů, Slevomat 7 617 (filtr), běhy dokončeny bez odmítnutých záznamů. Opraveno: Invia DTD (`SYSTEM` id) se zamítalo.
- Nenalezeno/neověřeno: České kormidlo má feed na http (selhávalo i ve WP) – zůstává vypnuto; několik pomalých Invia feedů (odpověď 50–100 s) se dokončí jen v cron invokaci (HTTP `waitUntil` je po ~30 s zrušen) – ověřit po zapnutí cronu (staging cron zapnut, výsledek ještě nevyhodnocen).
- Časy importu (staging, D1 remote): Fischer 33 min, Čedok 32 min, Exim 22 min při ručním spouštění po částech – **nejsou reprezentativní**, protože HTTP spuštění běží po 30 s a čeká na další spuštění; v cronu (*/10) se dokončí postupně. Reálné trvání a spotřebu D1 změřit po týdnu.

## Neověřeno / otevřené
Vizuální porovnání v prohlížeči (mobil/desktop), Lighthouse, test obnovy zálohy D1, test návratu na WordPress, zátěžový test, GA4 realtime, `/go/` per partner proti partnerským systémům, potvrzení provizí.
