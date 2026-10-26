import { beforeEach, describe, expect, it } from 'vitest';
import { handleGo, isCrawlerLike, isSafeTarget, DEFAULT_ALLOWED_HOSTS, sanitizeContext } from '../../src/lib/server/clicks';
import { CJ_URL, makeDb, seed } from '../admin/helpers';
import type { AppEnv } from '../../src/lib/server/env';

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
let db = makeDb();
beforeEach(() => { db = makeDb(); seed(db.raw); });

const env = (extra: Record<string, unknown> = {}) => ({ ENVIRONMENT: 'test', IP_HASH_SALT: 'salt', ...extra }) as unknown as AppEnv;
function req(path: string, headers: Record<string, string> = { 'user-agent': BROWSER, 'cf-connecting-ip': '203.0.113.7' }) {
  return new Request('https://kakapo.cz' + path, { headers });
}
async function go(kind: 'offer' | 'product', id: string, path: string, e = env(), headers?: Record<string, string>) {
  const pending: Promise<unknown>[] = [];
  const res = await handleGo({ kind, rawId: id, request: req(path, headers), env: e, db: db.sql, waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  return res;
}
const clicks = () => db.raw.prepare('SELECT * FROM clicks').all() as Array<Record<string, unknown>>;

describe('isSafeTarget (no open redirect)', () => {
  const ok = (u: string) => isSafeTarget(u, DEFAULT_ALLOWED_HOSTS);
  it('accepts https on allow-listed hosts and subdomains', () => {
    expect(ok(CJ_URL)).toBe(true);
    expect(ok('https://www.invia.cz/x')).toBe(true);
    expect(ok('https://ehub.cz/click/1')).toBe(true);
  });
  it.each([
    ['http scheme', 'http://www.kqzyfj.com/x'],
    ['foreign host', 'https://evil.example/x'],
    ['suffix trick', 'https://kqzyfj.com.evil.example/x'],
    ['prefix trick', 'https://evilkqzyfj.com/x'],
    ['userinfo trick', 'https://www.kqzyfj.com@evil.example/x'],
    ['userinfo on allowed host', 'https://user:pw@www.kqzyfj.com/x'],
    ['protocol-relative', '//evil.example/x'],
    ['javascript', 'javascript:alert(1)'],
    ['CRLF injection', 'https://www.kqzyfj.com/x\r\nSet-Cookie: a=b'],
    ['space', 'https://www.kqzyfj.com/a b'],
    ['non-ascii', 'https://www.kqzyfj.com/č'],
    ['empty', ''],
  ])('rejects %s', (_n, u) => expect(ok(u)).toBe(false));
  it('rejects non-strings', () => { expect(ok(null as unknown as string)).toBe(false); expect(ok(undefined as unknown as string)).toBe(false); });
});

describe('bot detection', () => {
  it.each(['', 'curl/8.4', 'Googlebot/2.1', 'python-requests/2.31', 'Mozilla/5.0 (compatible; AhrefsBot/7.0)', 'Mozilla/5.0 HeadlessChrome/120', 'facebookexternalhit/1.1', 'Go-http-client/2.0', 'Mozilla/5.0 (compatible; AliyunSecBot)'])('crawler: %j', (ua) => expect(isCrawlerLike(ua)).toBe(true));
  it('does not flag a real browser', () => expect(isCrawlerLike(BROWSER)).toBe(false));
});

describe('/go/{offerId}', () => {
  it('302 to the stored URL byte for byte, uncached, noindex', async () => {
    const r = await go('offer', '10', '/go/10/');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(CJ_URL); // %257C and %26 must not be touched
    expect(r.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(r.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(r.headers.get('set-cookie')).toBeNull();
  });
  it('ignores any URL given in the query string', async () => {
    const r = await go('offer', '10', '/go/10/?url=https://evil.example&redirect=//evil.example&next=http://evil.example');
    expect(r.headers.get('location')).toBe(CJ_URL);
  });
  it('logs a click with a salted hash, never the raw IP', async () => {
    await go('offer', '10', '/go/10/?ctx=Hotel Detail<script>');
    const c = clicks();
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ offer_id: 10, hotel_id: 1, product_id: 0, partner_slug: 'fischer', context: 'hoteldetailscript' });
    expect(String(c[0]!.ip_hash)).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(c[0])).not.toContain('203.0.113.7');
  });
  it('stores no hash when no salt is configured (outside local)', async () => {
    await go('offer', '10', '/go/10/', env({ ENVIRONMENT: 'production', IP_HASH_SALT: '' }));
    expect(clicks()[0]!.ip_hash).toBe('');
  });
  it('bots, empty UA and prefetch get 204 and no click', async () => {
    for (const h of [{ 'user-agent': 'Googlebot/2.1' }, { 'user-agent': '' }, {}, { 'user-agent': BROWSER, purpose: 'prefetch' }, { 'user-agent': BROWSER, 'sec-purpose': 'prefetch;prerender' }]) {
      const r = await go('offer', '10', '/go/10/', env(), h);
      expect(r.status).toBe(204);
      expect(r.headers.get('location')).toBeNull();
    }
    expect(clicks()).toHaveLength(0);
  });
  it.each(['0', '-1', 'abc', '1.5', '10abc', '99999999999999', '010', ''])('invalid id %j -> 404 noindex', async (id) => {
    const r = await go('offer', id, '/go/x/');
    expect(r.status).toBe(404);
    expect(r.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
  it('unknown id -> 404', async () => expect((await go('offer', '9999', '/go/9999/')).status).toBe(404));
  it('inactive offer falls back to the hotel page, never to a partner', async () => {
    const r = await go('offer', '11', '/go/11/');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/hotel/lino-mare/');
    expect(clicks()).toHaveLength(0);
  });
  it('offer of a hidden hotel falls back to its page', async () => {
    expect((await go('offer', '12', '/go/12/')).headers.get('location')).toBe('/hotel/hidden-hotel/');
  });
  it('an unsafe target stored in the DB is never redirected to', async () => {
    for (const id of ['13', '14']) {
      const r = await go('offer', id, `/go/${id}/`);
      expect(r.headers.get('location')).toBe('/hotel/lino-mare/');
    }
    expect(clicks()).toHaveLength(0);
  });
  it('rate limit -> 429 without a DB lookup or click', async () => {
    const r = await go('offer', '10', '/go/10/', env({ RL_GO: { limit: async () => ({ success: false }) } }));
    expect(r.status).toBe(429);
    expect(clicks()).toHaveLength(0);
  });
  it('a failing click write does not block the redirect', async () => {
    db.raw.exec('DROP TABLE clicks');
    const r = await go('offer', '10', '/go/10/');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(CJ_URL);
  });
});

describe('/akce/{productId}', () => {
  it('redirects to the stored product URL and logs product_id', async () => {
    const r = await go('product', '5', '/akce/5/');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://ehub.cz/click/abc?x=1&y=%2F');
    expect(clicks()[0]).toMatchObject({ offer_id: 0, product_id: 5, partner_slug: 'invia' });
  });
  it('hidden product -> 404', async () => {
    db.raw.exec('UPDATE products SET hidden = 1');
    expect((await go('product', '5', '/akce/5/')).status).toBe(404);
  });
});

describe('sanitizeContext', () => {
  it('keeps only [a-z0-9_-] and limits length', () => {
    expect(sanitizeContext('A b/c')).toBe('abc');
    expect(sanitizeContext(null)).toBe('go');
    expect(sanitizeContext('x'.repeat(100))).toHaveLength(30);
  });
});
