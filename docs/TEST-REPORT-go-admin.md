# Výsledky testů: /go, /akce a administrace

Spuštěno `npx vitest run tests/go tests/admin` (vitest 4.1.11, node 22.23.1, SQLite = reálné migrace 0001 + 0003 přes `node:sqlite`) dne 26. 10. 2026.

```
Test Files  2 passed (2)
Tests  81 passed (81)
```

## Případy

```
✓ tests/go/go.test.ts > isSafeTarget (no open redirect) > accepts https on allow-listed hosts and subdomains
✓ tests/go/go.test.ts > isSafeTarget (no open redirect) > rejects http scheme
✓ tests/go/go.test.ts > isSafeTarget (no open redirect) > rejects foreign host
✓ tests/go/go.test.ts > isSafeTarget (no open redirect) > rejects suffix trick
✓ tests/go/go.test.ts > isSafeTarget (no open redirect) > rejects prefix trick
✓ tests/go/go.test.ts > isSafeTarget (no open redirect) > rejects userinfo trick
✓ tests/go/go.test.ts > isSafeTarget (no open redirect) > rejects userinfo on allowed host
✓ tests/go/go.test.ts > isSafeTarget (no open redirect) > rejects protocol-relative
✓ tests/go/go.test.ts > isSafeTarget (no open redirect) > rejects javascript
✓ tests/go/go.test.ts > isSafeTarget (no open redirect) > rejects CRLF injection
✓ tests/go/go.test.ts > isSafeTarget (no open redirect) > rejects space
✓ tests/go/go.test.ts > isSafeTarget (no open redirect) > rejects non-ascii
✓ tests/go/go.test.ts > isSafeTarget (no open redirect) > rejects empty
✓ tests/go/go.test.ts > isSafeTarget (no open redirect) > rejects non-strings
✓ tests/go/go.test.ts > bot detection > crawler: ""
✓ tests/go/go.test.ts > bot detection > crawler: "curl/8.4"
✓ tests/go/go.test.ts > bot detection > crawler: "Googlebot/2.1"
✓ tests/go/go.test.ts > bot detection > crawler: "python-requests/2.31"
✓ tests/go/go.test.ts > bot detection > crawler: "Mozilla/5.0 (compatible; AhrefsBot/7.0)"
✓ tests/go/go.test.ts > bot detection > crawler: "Mozilla/5.0 HeadlessChrome/120"
✓ tests/go/go.test.ts > bot detection > crawler: "facebookexternalhit/1.1"
✓ tests/go/go.test.ts > bot detection > crawler: "Go-http-client/2.0"
✓ tests/go/go.test.ts > bot detection > crawler: "Mozilla/5.0 (compatible; AliyunSecBot)"
✓ tests/go/go.test.ts > bot detection > does not flag a real browser
✓ tests/admin/admin.test.ts > validateOverride > title: 60 ok, 61 rejected, no HTML
✓ tests/admin/admin.test.ts > validateOverride > normalises landing path
✓ tests/admin/admin.test.ts > validateOverride > rejects landing key recko/kos/
✓ tests/admin/admin.test.ts > validateOverride > rejects landing key //evil/
✓ tests/admin/admin.test.ts > validateOverride > rejects landing key /a?b=1
✓ tests/admin/admin.test.ts > validateOverride > rejects landing key /admin/x/
✓ tests/admin/admin.test.ts > validateOverride > rejects landing key /go/1/
✓ tests/admin/admin.test.ts > validateOverride > rejects landing key /a/../b/
✓ tests/admin/admin.test.ts > validateOverride > validates faqs_json
✓ tests/admin/admin.test.ts > validateOverride > rejects scripts in html fields and unknown kinds/fields/robots/canonical
✓ tests/admin/admin.test.ts > validateRedirect > accepts a normal redirect and a 410
✓ tests/admin/admin.test.ts > validateRedirect > rejects loops, external targets, reserved paths, params, bad status
✓ tests/admin/admin.test.ts > validateRedirect > rejects chains in both directions
✓ tests/admin/admin.test.ts > admin actions are validated and audited > feed pause/resume
✓ tests/admin/admin.test.ts > admin actions are validated and audited > hide hotel, hide offer (blocklist) and restore
✓ tests/admin/admin.test.ts > admin actions are validated and audited > save/replace/delete override, invalid input writes nothing
✓ tests/admin/admin.test.ts > admin actions are validated and audited > triggerImport: no binding, paused feed, success and refusal
✓ tests/go/go.test.ts > /go/{offerId} > 302 to the stored URL byte for byte, uncached, noindex
✓ tests/go/go.test.ts > /go/{offerId} > ignores any URL given in the query string
✓ tests/go/go.test.ts > /go/{offerId} > logs a click with a salted hash, never the raw IP
✓ tests/go/go.test.ts > /go/{offerId} > stores no hash when no salt is configured (outside local)
✓ tests/go/go.test.ts > /go/{offerId} > bots, empty UA and prefetch get 204 and no click
✓ tests/go/go.test.ts > /go/{offerId} > invalid id "0" -> 404 noindex
✓ tests/go/go.test.ts > /go/{offerId} > invalid id "-1" -> 404 noindex
✓ tests/go/go.test.ts > /go/{offerId} > invalid id "abc" -> 404 noindex
✓ tests/go/go.test.ts > /go/{offerId} > invalid id "1.5" -> 404 noindex
✓ tests/go/go.test.ts > /go/{offerId} > invalid id "10abc" -> 404 noindex
✓ tests/go/go.test.ts > /go/{offerId} > invalid id "99999999999999" -> 404 noindex
✓ tests/go/go.test.ts > /go/{offerId} > invalid id "010" -> 404 noindex
✓ tests/go/go.test.ts > /go/{offerId} > invalid id "" -> 404 noindex
✓ tests/go/go.test.ts > /go/{offerId} > unknown id -> 404
✓ tests/go/go.test.ts > /go/{offerId} > inactive offer falls back to the hotel page, never to a partner
✓ tests/go/go.test.ts > /go/{offerId} > offer of a hidden hotel falls back to its page
✓ tests/go/go.test.ts > /go/{offerId} > an unsafe target stored in the DB is never redirected to
✓ tests/go/go.test.ts > /go/{offerId} > rate limit -> 429 without a DB lookup or click
✓ tests/go/go.test.ts > /go/{offerId} > a failing click write does not block the redirect
✓ tests/go/go.test.ts > /akce/{productId} > redirects to the stored product URL and logs product_id
✓ tests/go/go.test.ts > /akce/{productId} > hidden product -> 404
✓ tests/go/go.test.ts > sanitizeContext > keeps only [a-z0-9_-] and limits length
✓ tests/admin/admin.test.ts > admin authentication fails closed > no Access configuration -> 503 (staging/production)
✓ tests/admin/admin.test.ts > admin authentication fails closed > configured but no JWT -> 401
✓ tests/admin/admin.test.ts > admin authentication fails closed > garbage JWT -> 403 (or 503 if certs unreachable), never ok
✓ tests/admin/admin.test.ts > admin authentication fails closed > local bypass works only in local/test with the flag, never in production
✓ tests/admin/admin.test.ts > admin authentication fails closed > requireAdmin without configuration returns an error page, not content
✓ tests/admin/admin.test.ts > Access JWT verification > accepts a valid token
✓ tests/admin/admin.test.ts > Access JWT verification > rejects wrong audience, issuer, expired, not-yet-valid, wrong alg, bad signature
✓ tests/admin/admin.test.ts > CSRF on admin POST > valid token + same origin passes
✓ tests/admin/admin.test.ts > CSRF on admin POST > missing, wrong or foreign-user token is refused (403)
✓ tests/admin/admin.test.ts > CSRF on admin POST > cross-origin or origin-less POST is refused even with a valid token
✓ tests/admin/admin.test.ts > CSRF on admin POST > GET on a POST endpoint -> 405; unauthenticated POST -> auth error before any parsing
✓ tests/admin/admin.test.ts > normalizePath > lower-cases and adds trailing slash
✓ tests/admin/admin.test.ts > normalizePath > rejects "a/"
✓ tests/admin/admin.test.ts > normalizePath > rejects "//x"
✓ tests/admin/admin.test.ts > normalizePath > rejects "/a b/"
✓ tests/admin/admin.test.ts > normalizePath > rejects "/a?x"
✓ tests/admin/admin.test.ts > normalizePath > rejects "/a#x"
✓ tests/admin/admin.test.ts > normalizePath > rejects "/a\\b/"
```

## Co tyto testy NEpokrývají
- Astro stránky (`.astro`) a skutečné D1 / workerd runtime: `astro check` nelze spustit, protože Astro 7.4.2 vyžaduje Node >= 22.23.4 a v Malině je 22.23.1 (build tedy zatím nebyl ověřen). Logika je v čistém TS (`src/lib/**`) a ověřená `tsc` kontrola bez chyb pro `src/lib/admin`, `src/lib/server/clicks.ts`, `src/pages/go|akce|api/admin`.
- Skutečná verifikace Cloudflare Access JWT proti živým certifikátům (testováno vlastním RSA klíčem a JWKS).
- Zátěž a chování `RL_GO` binding (v testu mock).
