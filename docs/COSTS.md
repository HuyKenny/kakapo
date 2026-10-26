# Náklady (ceníky ověřeny z oficiální dokumentace 26. 10. 2026)

| Položka | Cena | Zdroj |
|---|---|---|
| Workers Paid | 5 USD/měs. za účet; 10 mil. požadavků a 30 mil. CPU ms zahrnuto; pak 0,30 USD/mil. požadavků a 0,02 USD/mil. CPU ms; cron = běžné vyvolání, max. 15 min CPU | developers.cloudflare.com/workers/platform/pricing |
| D1 | 25 mld. přečtených a 50 mil. zapsaných řádků/měs. zahrnuto; pak 0,001 USD/mil. přečtených a 1 USD/mil. zapsaných; 5 GB zahrnuto, pak 0,75 USD/GB | …/d1/platform/pricing |
| R2 | 0,015 USD/GB-měs.; Class A 4,50 USD/mil., Class B 0,36 USD/mil.; zdarma 10 GB, 1 mil. A, 10 mil. B; egress zdarma | …/r2/pricing |

Sdílený účet: už dnes spotřebuje D1 ~2,4 mld. přečtených řádků/den (pokector, pixuvo), tedy ~72 mld./měs., a platí přes zahrnutých 25 mld. Kakapo se do toho přičítá.

## Odhad (předpoklady označeny, nic z toho není změřeno v produkci)
Změřeno: velikost dat ~470 MB ve WP (po převodu na D1 bez 72 tis. neaktivních nabídek a bez historie kliků řádově 200–300 MB), 22 741 aktivních nabídek, WEDOS pool ~35 tis. renderů/den.

A) Současný provoz (předpoklad: 1,1 mil. požadavků/měs. na HTML+API, ~70 % z cache hit; SSR ~15 ms CPU)
- Workers: ~1,1 mil. požadavků + ~5 mil. CPU ms: v rámci zahrnutého.
- D1 čtení: cache miss ~330 tis. × ~20 tis. řádků = ~7 mld. řádků/měs. ≈ 7 USD (0,001 USD/mil.).
- D1 zápisy: importy zapisují jen změněné nabídky (test na 22,7 tis. nabídek: opakovaný import 0 zápisů, 5 % změn ≈ 2 270 zápisů; s indexy ×~5): ~2 mil. řádků/měs. ≪ 50 mil.
- R2: snapshoty (retence 7 dní), jednotky GB: < 1 USD.
- Cron import Worker: 144 vyvolání/den (každých 10 min) + běhy feedů; CPU náročné parsování Slevomat (140 MB) → hrubý odhad 2–10 mil. CPU ms/měs.
- Odhad celkem: základ 5 USD (sdílený s ostatními weby) + do ~10 USD přírůstek.

B) 5× růst návštěvnosti: čtení D1 ~35 mld. → ~35 USD; Workers 5,5 mil. požadavků, ~25 mil. CPU ms → blízko zahrnutého.
C) Náročnější importy (30 % změn každý běh, 6 běhů/den): zápisy ~25 mil. řádků/měs. (stále v zahrnutých 50 mil.), CPU ~30–60 mil. ms → 0–1 USD.

Pojistky: Cache API 300 s + `data_version`; rate limity (`RL_GO`, `RL_SEARCH`, `RL_ADMIN`); strop stránkování; boti na /go dostávají 204 bez zápisu; import zapisuje jen změněné řádky. Upozornění na spotřebu: Cloudflare billing notifications (nejsou tvrdým limitem faktury).
Po týdnu na stagingu/produkci přepočítat z `wrangler`/dashboard čísel (TODO v TEST-REPORT).
