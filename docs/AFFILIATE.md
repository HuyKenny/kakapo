# Affiliate přesměrování `/go/{id}` a `/akce/{id}`

Kód: `src/lib/server/clicks.ts`, routy `src/pages/go/[id].ts` (nabídky hotelů) a `src/pages/akce/[id].ts` (produkty).

## Chování
| Situace | Odpověď |
|---|---|
| platná aktivní nabídka | `302` na `affiliate_url` z D1 **přesně jak je uložená** (bez re-encodování a přeskládání parametrů), `Cache-Control: private, no-store, max-age=0`, `X-Robots-Tag: noindex, nofollow`, `X-Kakapo-Go: d1` |
| bot / prázdné UA / prefetch | `204`, `X-Kakapo-Go: bot-skip`, žádný zápis (stejný seznam UA jako dosavadní Worker + Alibaba/Bytespider/headless apod.) |
| neaktivní nabídka nebo skrytý hotel | `302` na `/hotel/{slug}/` (nabídka se nikdy neutopí na homepage); bez hotelu `404` |
| neplatné ID (`0`, `abc`, `010`, příliš dlouhé) | `404` noindex |
| cíl v DB není https na povoleném hostu | chyba do logu, `302` na detail hotelu nebo `404`; na partnera se nikdy nepřesměruje |
| překročen `RL_GO` (40/min na IP) | `429` + `Retry-After` |

## Bezpečnost
- **Open redirect:** cíl se bere jen z D1, nikdy z query. Parametr `?url=` se ignoruje (test). Cíl musí být `https`, bez `user:pass@`, jen znaky `0x21–0x7e` (žádné CRLF/mezery/diakritika) a host musí být rovný nebo subdoména hostu z allowlistu (`DEFAULT_ALLOWED_HOSTS`: CJ domény `anrdoezrs.net`, `jdoqocy.com`, `tkqlhce.com`, `dpbolvw.net`, `kqzyfj.com`, dále `invia.cz`, `dovolena.cz`, `slevomat.cz`, `ehub.cz`, `radynacestu.cz`, `cedok.cz`, `fischer.cz`, `exim.cz`, `blue-style.cz`, `tui.cz`). Další hosty: proměnná `GO_ALLOWED_HOSTS` (čárkami). Hosty vycházejí z reálných dat exportu 26. 10. 2026 (97 906 URL).
- **Cache:** odpověď je `private, no-store`, takže se identifikátor jednoho návštěvníka nemůže dostat k jinému. Jedinou veřejnou cache má `204` pro boty (bez identifikátorů).
- **Klik:** zapisuje se v `ctx.waitUntil` do `clicks` (offer_id, hotel_id, product_id, partner_slug, context, ip_hash, clicked_at). `ip_hash` = prvních 32 hex sha256(`IP_HASH_SALT|den|IP`), bez soli (mimo local) se neukládá nic. Selhání zápisu redirect neblokuje (test).
- Odkaz funguje bez GA4. Událost `affiliate_click` v GA4 odesílá frontend (jiná část); `/go` s ní nesouvisí a nemůže vzniknout dvojí počítání.
- Rate limit je v routě (ne v middleware), takže funguje i bez něj. Binding `RL_GO` je ve `wrangler.jsonc` (namespace 73001); ve staging/production sekcích ho musí přidat ten, kdo je zakládá.

## Co zbývá mimo tento kus
- Zkontrolovat pravidla partnerů pro vlastní redirect (CJ, ehub) a nastavit `disclosure` v `partners`. Provize se nedají ověřit bez potvrzení sítě.
- Šablony musí odkazy značit `rel="sponsored nofollow"`.
- Frontend má volat `/go/{id}/?ctx=…` (kontext `[a-z0-9_-]{1,30}`).
