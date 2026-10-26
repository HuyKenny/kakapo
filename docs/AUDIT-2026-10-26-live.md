# Audit živého kakapo.cz po přepnutí (26. 10. 2026 večer)

## Stav
| Oblast | Výsledek |
|---|---|
| Dostupnost | hlavní stránky 200, 404 se stavem 404 + noindex, www→apex, http→https, 301 bez lomítka, `/dovolena/`→`/zajezdy/` |
| Rychlost (Malina, Praha→VIE) | HTML z edge cache ~0,16 s TTFB (dřív 0,5–1,2 s, cache nefungovala); Lighthouse mobil (workers.dev, Malina CPU): hotel 86 (LCP 2,3 s), home 80, výpis 73 (LCP = foto přes proxy wsrv.nl), best practices 100, SEO 92 |
| CPU webu | p50 26 ms, p99 135 ms (předtím p99 544 ms) |
| D1 čtení | 41 mil. řádků/15 min → ~14 tis./15 min po opravách |
| Importy | 37 feedů ok, Č. kormidlo (125 MB) běží, Dovolena lyžování je prázdný zdroj (0 položek – sezónní), 0 aktivních nabídek s prošlým odjezdem, historie cen dnes |
| Zabezpečení | admin a `/api/admin` za Cloudflare Access, `/go/` jen z DB (bez open redirectu, `private, no-store`), WAF 403 na `/.env`, `/wp-config.php`, `/.git/HEAD`, rate limity, CSP (`frame-ancestors`, `object-src`, `base-uri`, `form-action`), HSTS, nosniff, žádné secrets v buildu (`verify-no-secrets`) |
| SEO | canonical, robots, sitemapy (24 659 URL), JSON-LD (Organization, Breadcrumb, Hotel, FAQ, ItemList), utm/fbclid už nedělají noindex, staré `/go/ID` → 302 `/zajezdy/` |

## Opravy provedené v rámci auditu
1. **Edge cache:** staré cache pravidlo zóny z doby WordPressu („Edge-cache HTML pages…", custom cache key bez query) blokovalo Cache API Workeru → vypnuto (záloha `backups/kakapo-cf-cache-rules-2026-10-26.json`). Cache klíč nese verzi dat v cestě. HIT odpovědi mají `max-age=0, must-revalidate` (jinak by zónové browser TTL 4 h drželo staré ceny v prohlížeči). TTL 600 s.
2. **Importér:** snapshoty (registry, fasety, `data_version`) se přepočítávají jednou za cron tick a jen po zápisu dat (dřív po každém ze 40 feedů → cache stále studená a miliony čtení). http feedy se stahují přes https (Adrop opraven).
3. **Assety:** `Cache-Control: max-age=31536000, immutable` + `?v=<build>` na CSS/JS.
4. **Výkon:** první 2 karty výpisu bez lazy-load s `fetchpriority=high`, hotel hero se `srcset` a preloadem, preconnect na wsrv.nl, index `idx_hotels_live`.
5. **SEO/bezpečnost:** viz tabulka.

## Zbývá / doporučení
- Malina (Kenny): crontab Čedok `--target r2`, vypnout `kakapo-nocni-purge` a cron-job.org ping `wp-cron.php` kakapo.
- LCP výpisů závisí na proxy wsrv.nl (první stažení fotky od partnera). Vlastní cache obrázků (R2) by pomohla, ale je to větší změna.
- TBT 400–800 ms (lab): velký DOM (~1 850 prvků) a Alpine – zmenšit jen se změnou designu.
- WAF dává bezhlavému Chrome challenge – měření Lighthouse/PSI dělat přes `kakapo.huy-kenny.workers.dev`.
