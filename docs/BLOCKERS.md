# Blokery a otevřená rozhodnutí (stav 26. 10. 2026)

| # | Bloker | Co je potřeba | Kdo |
|---|---|---|---|
| 1 | Feed URL s tokeny (Invia, Dovolena.cz, Slevomat, Excursia, Zážitky, Rady na cestu) | Plugin je z exportu záměrně nevydává. Tokeny nutno zadat jako Worker secrets `FEED_URL_<id>` z DB nebo od Kennyho | Claude + Kenny |
| 2 | Cloudflare D1/R2 pro staging a produkci | `wrangler d1 create` a R2 bucket = nové zdroje na účtu (v rámci Paid plánu, bez příplatku, ale mění účet). Čeká na potvrzení | Kenny |
| 3 | Cloudflare Access aplikace pro staging a `/admin` | Vytvoření Access app + AUD secret | Kenny/Claude |
| 4 | Produkční přepnutí (route/DNS), vypnutí WP importů, ukončení WEDOS | Výslovné potvrzení; DNS/pošta se nesmí měnit bez něj | Kenny |
| 5 | Účet CF už nese D1 čtení ~47 USD/měs. (pokector, pixuvo) | Kakapo nesmí přidat full-scany; pojistky a měření v COSTS.md | Claude |
| 6 | Čedok (SFTP 3,4 GB) | Zůstává na Malině (`scripts/kakapo/cedok-slim-feed.py`), nahrává slim feed do R2 | Claude |
| 7 | Provize / atribuce | Funkční odkaz neprokazuje připsání; nutné potvrzení z CJ/partnerů (CJ Commission Detail API) | Kenny |
| 8 | Právní texty | Beze změny převést, označit k posouzení; žádné prohlášení o souladu | Kenny |
