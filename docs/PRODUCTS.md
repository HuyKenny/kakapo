# Produktová sekce, právní stránky a 404 (Astro port)

Zdroj: `templates/{products-hub,products,product,legal,404}.php`, `parts/card-product.php`, `class-product-*.php`, produktové části `class-seo.php`.
Kód: `src/lib/products/**`, `src/components/products/**`, `src/pages/{objevte,zazitek,404,ochrana-osobnich-udaju,podminky-pouziti,kontakt}`.

## Napojení v catch-all routě hlavního vlákna
Kategorie a landingy produktů nejsou samostatné soubory (jsou to jednosegmentové cesty, kolidovaly by s catch-all pro hotelové landingy). Catch-all je volá takto:

```astro
import { resolveProductRoute, loadCategory, categoryUrl } from '../lib/products';
import Category from '../components/products/Category.astro';
const r = await resolveProductRoute(db(), Astro.url.pathname);
if (r?.kind === 'category' || r?.kind === 'landing') {
  const view = await loadCategory(db(), siteUrl(), { type: r.type, landing: r.kind === 'landing' ? r.landing : null }, Astro.url.searchParams);
  // <Base title={view.meta.title} description={view.meta.description} canonical={view.meta.canonical} robots={view.meta.robots}
  //       {...(view.meta.image ? { ogImage: view.meta.image } : {})} jsonLd={view.meta.jsonLd} pageType="products"><Category view={view} /></Base>
}
```
Pořadí v PHP routeru: topic landingy (80) → `/objevte/` → produktové landingy → kategorie → hotelové `/{zeme}/`. Kolize slugů mezi topic landingy, produktovými landingy a kategoriemi jsou 0 (ověřeno na datech), takže pořadí není kritické; `resolveProductRoute` vrací `null` pro cokoli mimo sekci.
`/zazitek/{slug}/` obsluhuje `src/pages/zazitek/[slug].astro` (404 se stavem 404 a noindex; stránka vrací vlastní 404 obsah).

Každý load vrací `meta` = `{title, description, canonical (absolutní), robots[], image, jsonLd[], breadcrumbs[]}`. Hub navíc `extraJsonLd` (samostatný FAQPage, v PHP byl v těle stránky, teď v `<head>`).

## Rozhodnutí a odchylky od PHP
| Téma | PHP | Port |
|---|---|---|
| Neaktivní/neznámý produkt | `product.php` obsahuje 302 na kategorii, ale router nastaví 404 dřív (mrtvý kód) → živě **404** | **404 + noindex** (živé chování). Volba `resolveProductRoute(db, path, { redirectGone: true })` zapne 302 na kategorii (u `hidden=1` vždy 404) |
| `hidden=1` (admin skrytí) | neexistuje | nikde se nezobrazuje, ani v počtech, hledání, podobných, JSON-LD |
| Hledání `q` | MySQL `LIKE` v ci kolaci (bez diakritiky/velikosti) | SQLite `LIKE` skládá jen ASCII → **migrace 0006**: sloupec `products.search_text` (složený text title+description+country+destination+place+type_raw) udržovaný **triggery** (INSERT i UPDATE těchto sloupců), dotaz se skládá stejně (`foldText`). Importér ani loader nic dělat nemusí; stávající řádky dopočítá `UPDATE products SET title = title` (je v migraci) |
| `type_raw NOT REGEXP '^[0-9]+$'` | MySQL regex | `GLOB '*[^0-9]*'` (D1 nemá REGEXP) |
| `?t=` u termínů | index v profiltrovaném seznamu (budoucí termíny) – ukazoval do původního pole špatně | index v **původním** `meta.terms` (`idx`), jak ho čte `/akce/{id}/?t=`. **Požadavek na /akce handler** (go fork): při `?t=N` použít `meta_json.terms[N].url`, pokud existuje – v `clicks.ts` se `t` zatím nečte |
| Řazení `title` | MySQL kolace | `COLLATE NOCASE` (česká abeceda se může lišit u č/ř/š) |
| Filtrační formulář kategorie | skryté pole pro cenu/zemi se neposílalo | přidána skrytá pole `cena`, `zeme`, `lokalita`, `typ`, aby se filtry neztratily po odeslání |
| Robots kategorie | `index` jen když `total >= index_min` a žádný z parametrů `sort,strana,zeme,partner,q,cena,lokalita,typ` | stejně (`meta.ts`); `total` z hledání se zamčenými filtry landingu |
| Odkazy `/akce/…` | `rel="nofollow sponsored noopener"`, `data-kakapo-partner`, `data-kakapo-price`, `target=_blank` | beze změny (GA4 událost `affiliate_click` je delegovaná v `lib/analytics.ts`) |
| Obrázky | `wsrv.nl` proxy (`imgUrl`) | beze změny |

## Právní stránky (k posouzení)
Texty `ochrana-osobnich-udaju`, `podminky-pouziti`, `kontakt` jsou **doslovně** z `legal.php` (`src/lib/products/content.ts`, `LEGAL_HTML`). Neobsahují provozovatele (jméno/IČO/adresu), správce údajů, dobu uchování, seznam zpracovatelů (Cloudflare, GA4, partneři), právní základ ani informaci o cookies jmenovitě. Označeno **k právnímu posouzení** – nic jsem nedoplňoval ani netvrdil o souladu s GDPR/cookie lištou. Kontakt `info@kakapo.cz` je z původních textů (nutno ověřit, že schránka existuje a po migraci funguje – poštu neřeší tento web).

## Požadavky na hlavní vlákno / jiné části
1. `Base.astro` má `ogImage?: string` s `exactOptionalPropertyTypes` – stránky musí předávat `{...(img ? { ogImage: img } : {})}`; lepší je typ `ogImage?: string | undefined`.
2. Hub potřebuje, aby `Header.astro` počty (`productCounts`) vynechávaly `hidden=1` – už tak dělá.
3. `/esim/` a `/kompenzace-za-let/` (odkazy v patičce a v `/objevte/`-souvisejících) nejsou v mém rozsahu – ověřit, zda jsou to topic landingy.
4. Middleware cache: produktové stránky jsou SSR z D1, doporučené TTL ≤ 300 s (jako PHP page cache); 404 posílá `cache-control: public, max-age=60`.
5. Sitemap produktů (`/zazitek/{slug}/`, kategorie, landingy s `total >= index_min`) – `class-seo.php` `collect_sitemap_urls`; není součástí tohoto úkolu.

## Testy
`tests/products/products.test.ts` (19 testů, vitest + `node:sqlite` jako D1 nad všemi `migrations/*.sql`): routování, hidden/inactive/unknown, redirectGone, accent-insensitive hledání a trigger, filterOptions, similar, meta (titulek ≤ 60, popisek ≤ 158, canonical, JSON-LD Product/FAQ/Breadcrumb), indexovatelnost kategorie a landingu, hub, právní meta, term odkazy.
Ověřeno ručně: `astro build` + `wrangler dev` s lokální D1 → `/objevte/` 200, `/zazitek/{slug}/` 200 (noindex mimo production, `rel="nofollow sponsored noopener"`, JSON-LD Product), skrytý produkt 404, `/kontakt/` 200. Vizuální porovnání s WP a kategorie/landing komponenta v běžícím catch-all **neověřeny** (catch-all ještě neexistuje).
