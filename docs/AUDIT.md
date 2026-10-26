# Audit současného WordPressu kakapo.cz (26. 10. 2026)

Zdroje: čtení z kódu pluginu `weby/kakapo/travel-engine`, produkční REST (`/maintenance/freshness`, nový read-only `/maintenance/export`), `information_schema`. Žádný zápis do produkční DB.

## Skutečný rozsah dat
| Entita | Hodnota | Zdroj |
|---|---|---|
| Hotely | 22 030 řádků (z toho většina bez aktivní nabídky) | export 26. 10. |
| Nabídky aktivní | 22 741 (Čedok 9 657, Dovolena.cz 3 013, Invia 2 850, Fischer 2 403, Exim 1 946, Slevomat 1 736, TUI 1 058, Blue Style 78) | freshness |
| Nabídky neaktivní | 72 065 (Invia 35 033, Čedok 25 877) – do D1 se nepřenášejí | freshness |
| Produkty | 3 100 | export |
| price_history | ~1,2 mil. řádků (retence 180 dní) | information_schema |
| clicks | ~646 tis. řádků (76 MB, velká část bot provoz) | information_schema |
| WP DB celkem (kakapo tabulky) | ~473 MB včetně indexů | information_schema |
| Příspěvky, stránky, CPT, WooCommerce | 0 / 0 / žádné / ne | kód pluginu, paměť |

Zadání mluví o ~100 000 produktech: to je maximum tabulky, ne aktivní katalog. Aktivních nabídek je ~23 tis.

## Tabulka funkcí
| Funkce | Současné řešení | Nové řešení | Stav | Ověření |
|---|---|---|---|---|
| Katalog hotelů/nabídek | tabulky `wp_kakapo_*` | D1 `hotels`, `offers`, `products` | schéma 0001 hotové, import dat čeká | počty podle partnerů WP vs D1 |
| Importy feedů | PHP stavový stroj, cron z Maliny každé 2 min | Import Worker + cron, adaptér per formát, bloky v R2 | nezačato | testy v workerd |
| Čedok slim feed | Malina SFTP → FTP → feed #41 | Malina → R2 → import Worker | nezačato | |
| `/go/` | CF Worker + WP REST | Worker čte D1, cache API | nezačato | test per partner |
| Landing texty | option `kakapo_landing_texts` | `editorial_overrides` | nezačato | diff textů |
| Landingy a routy | `class-router.php`, `class-topic-landings.php` aj. | Astro routy | nezačato | URL mapa |
| SEO (title, canonical, noindex, JSON-LD) | `class-seo.php` | Astro helper | nezačato | `seo-snapshot.py --diff` |
| Sitemap | Rank Math provider + `/sitemap-kakapo.xml` | předgenerované do R2 po importu | nezačato | |
| Přesměrování | `canonical_alias_target`, merge hotelů | `redirects` | nezačato | |
| GA4 + souhlas | `class-analytics.php`, Consent Mode v2 | beze změny názvů událostí | nezačato | |
| Administrace | wp-admin + REST | stránka za Access | nezačato | |
| Vyhledávání/filtry | REST `/search`, `/filters` | SQL nad indexy, limity | nezačato | EXPLAIN |

Chybí zatím: seznam existujících přesměrování z DB (option/Rank Math), robots.txt obsah, ověřovací DNS záznamy, GTM (nenalezeno, měření je přímo gtag), Search Console data (`scripts/kakapo/gsc-tyden.py`, property `sc-domain:kakapo.cz`).
