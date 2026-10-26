# SEO migrace

Zásada: žádná změna URL, textů, canonical a robots. Redesign ani slučování indexovaných stránek není součástí migrace.

## Inventář a pravidla URL
- Zdroje: živé sitemapy (`/sitemap_index.xml` → `kakapo-sitemap1..N.xml`, 1 000 URL/soubor), databáze (hotely, produkty, registry), GSC (`scripts/kakapo/gsc-tyden.py`).
- Zachováno: `/`, `/hotel/{slug}/`, `/zazitek/{slug}/`, `/zajezdy/`, `/last-minute/`, `/first-minute/`, `/zlevneno/`, stravy, `/odlet-z-{letiště}/`, `/{země}/`, `/{země}/{destinace}/`, `/{země}/{téma}/`, `/{země}/{destinace}/{téma}/`, 80 topic landingů, 13 stránek CK, produktové kategorie a landingy, `/objevte/`, právní stránky, `/go/`, `/akce/`.
- 301: `/dovolena/` → `/zajezdy/`, `/dovolena-i-more/` → `/dovolena-u-more/`, `/vlastni-dopravou/` → `/dovolena-vlastni-dopravou/`, 29 aliasů + prefixová pravidla duplicitních landingů (`src/data/landing-aliases.json`, `canonicalAliasTarget`), 60 sloučených hotelů (`redirects`), URL bez lomítka → s lomítkem.
- 404 se stavem 404 + noindex pro neznámé cesty, skryté a neaktivní produkty; hotel mimo ochrannou lhůtu zůstává dostupný s noindex (jako dnes).
- Přesměrování se řeší v kódu a v D1 (`redirects`), ne obřím souborem pravidel.

## Metadata
Title, description, canonical, robots a JSON-LD generuje stejná logika jako plugin (`landingTitle` ≤ 60 znaků, noindex pod 12 výsledků, query varianty noindex s kanonickou čistou URL, ochranná lhůta hotelů 180 dní). Oracle testy proti živému webu: landingy 24 URL, hotely 16 URL, výpisy/home 9 URL – shoda v title, H1, description, canonical, robots, H2, FAQ, počtech karet.
Rozdíly: `robots` se zapisuje `index,follow` (bez mezery); entity `&nbsp;` místo znaku U+00A0 po dekódování totožné.

## Sitemapy
Stejné URL jako dosud (Rank Math schéma): `/sitemap_index.xml`, `/kakapo-sitemap{N}.xml` (1 000 URL), plus `/sitemap-kakapo.xml` (vše, noindex). Předpočítané do `site_cache` po importu (max. 1× za 20 h), nikdy při požadavku. Pravidla zahrnutí převzata z `collect_sitemap_urls` (neprázdné landingy, ne aliasy, hotely s obsahem a aktuální nabídkou/ochrannou lhůtou, produkty aktivní). Rozdíl: sitemapy ve staré verzi měly XSL stylesheet `main-sitemap.xsl` (kosmetika Rank Math, nepřenáší se).

## robots.txt
Obsah převzat z živého webu (`src/data/robots.txt`): Disallow /go/, /akce/, /goproduct/, Content-Signal, blokace AI botů, odkaz na `sitemap_index.xml`. Mimo produkci `Disallow: /` a `X-Robots-Tag: noindex`.

## Měření a hlavičky
GA4 `G-WHF1DJMDBB` s Consent Mode v2 (výchozí denied), událost `affiliate_click` beze změny. Bezpečnostní hlavičky bez CSP (WP web žádnou neměl, Alpine vyžaduje unsafe-eval) – CSP je otevřený úkol.

## Staging
Cloudflare Access na celém hostu `kakapo-staging.huy-kenny.workers.dev` + kontrola JWT ve Workeru, `X-Robots-Tag: noindex` a `Disallow: /` mimo produkci. Pojistka: `ENVIRONMENT=production` je jediný režim, který zapíná indexaci a GA4.

## Po přepnutí sledovat
`scripts/kakapo/gsc-tyden.py` (stop-podmínka: pokles impresí > 20 %), GA4 (zdroje chatgpt.com), 404/5xx v Cloudflare, počty URL v sitemapách vs. GSC, Seznam/Bing webmaster.
