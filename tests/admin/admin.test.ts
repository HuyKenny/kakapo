import { beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { env as stubEnvTyped } from 'cloudflare:workers';
const stubEnv = stubEnvTyped as unknown as Record<string, any>;
import { makeDb, seed } from './helpers';
import { normalizePath, validateOverride, validateRedirect } from '../../src/lib/admin/validate';
import { deleteOverride, hideHotel, hideOffer, saveOverride, saveRedirect, setFeedEnabled, triggerImport } from '../../src/lib/admin/actions';
import { authenticateAdmin, verifyAccessJwt, type Jwk } from '../../src/lib/server/access';
import { csrfToken, verifyCsrf } from '../../src/lib/server/csrf';
import { requireAdmin, requireAdminPost } from '../../src/lib/admin/guard';

let db = makeDb();
beforeEach(() => { db = makeDb(); seed(db.raw); for (const k of Object.keys(stubEnv)) delete stubEnv[k]; });
const audits = () => db.raw.prepare('SELECT action, target, actor FROM admin_audit ORDER BY id').all() as Array<{ action: string; target: string; actor: string }>;

describe('validateOverride', () => {
  const v = (kind: string, key: string, field: string, value: string) => validateOverride(kind, key, field, value);
  it('title: 60 ok, 61 rejected, no HTML', () => {
    expect(v('landing', '/recko/kos/', 'title', 'a'.repeat(60)).ok).toBe(true);
    expect(v('landing', '/recko/kos/', 'title', 'a'.repeat(61))).toMatchObject({ ok: false });
    expect(v('landing', '/recko/kos/', 'title', '<b>x</b>')).toMatchObject({ ok: false });
  });
  it('normalises landing path', () => expect(v('landing', '/Recko/Kos', 'h1', 'Kos')).toMatchObject({ ok: true, value: { key: '/recko/kos/' } }));
  it.each(['recko/kos/', '//evil/', '/a?b=1', '/admin/x/', '/go/1/', '/a/../b/'])('rejects landing key %s', (k) => expect(v('landing', k, 'h1', 'x').ok).toBe(false));
  it('validates faqs_json', () => {
    expect(v('landing', '/a/', 'faqs_json', '[{"q":"Q?","a":"A."}]').ok).toBe(true);
    for (const bad of ['{"q":"x"}', '[{"q":"x"}]', 'not json', '[{"q":"","a":"x"}]']) expect(v('landing', '/a/', 'faqs_json', bad).ok).toBe(false);
  });
  it('rejects scripts in html fields and unknown kinds/fields/robots/canonical', () => {
    expect(v('landing', '/a/', 'seo_text', '<p>ok</p><script>x</script>').ok).toBe(false);
    expect(v('landing', '/a/', 'intro', '<a onclick="x()">y</a>').ok).toBe(false);
    expect(v('nope', '/a/', 'h1', 'x').ok).toBe(false);
    expect(v('landing', '/a/', 'nope', 'x').ok).toBe(false);
    expect(v('landing', '/a/', 'robots', 'follow').ok).toBe(false);
    expect(v('landing', '/a/', 'canonical', 'https://evil.example/').ok).toBe(false);
    expect(v('landing', '/a/', 'canonical', 'https://kakapo.cz/recko/').ok).toBe(true);
    expect(v('landing', '/a/', 'h1', '   ').ok).toBe(false);
    expect(v('hotel', 'Bad Slug', 'h1', 'x').ok).toBe(false);
  });
});

describe('validateRedirect', () => {
  const r = (a: string, b: string, s = 301) => validateRedirect(db.sql, a, b, s);
  it('accepts a normal redirect and a 410', async () => {
    expect(await r('/Stara/', '/nova/')).toMatchObject({ ok: true, value: { from: '/stara/', to: '/nova/', status: 301 } });
    expect(await r('/zrusena/', '', 410)).toMatchObject({ ok: true, value: { to: '', status: 410 } });
  });
  it('rejects loops, external targets, reserved paths, params, bad status', async () => {
    expect((await r('/a/', '/a/')).ok).toBe(false);
    expect((await r('/a/', 'https://evil.example/')).ok).toBe(false);
    expect((await r('/a/', '//evil.example/')).ok).toBe(false);
    expect((await r('/admin/', '/a/')).ok).toBe(false);
    expect((await r('/', '/a/')).ok).toBe(false);
    expect((await r('/a/?x=1', '/b/')).ok).toBe(false);
    expect((await r('/a/', '/go/1/')).ok).toBe(false);
    expect((await r('/a/', '/b/', 200)).ok).toBe(false);
  });
  it('rejects chains in both directions', async () => {
    expect((await saveRedirect(db.sql, 'a@b', '/a/', '/b/', 301)).ok).toBe(true);
    expect((await r('/b/', '/c/')).ok).toBe(false); // /b/ is already a target of /a/
    expect((await r('/x/', '/a/')).ok).toBe(false); // /a/ is already a source
    expect((await r('/b/', '/a/')).ok).toBe(false); // would close a loop
  });
});

describe('admin actions are validated and audited', () => {
  it('feed pause/resume', async () => {
    expect((await setFeedEnabled(db.sql, 'a@b', 1, false)).ok).toBe(true);
    expect(db.raw.prepare('SELECT enabled FROM feeds WHERE id=1').get()).toEqual({ enabled: 0 });
    expect((await setFeedEnabled(db.sql, 'a@b', 99, true)).ok).toBe(false);
    expect(audits()).toEqual([{ action: 'feed.pause', target: 'feed:1', actor: 'a@b' }]);
  });
  it('hide hotel, hide offer (blocklist) and restore', async () => {
    expect((await hideHotel(db.sql, 'a@b', 1, true, 'chybná data')).ok).toBe(true);
    expect(db.raw.prepare('SELECT hidden FROM hotels WHERE id=1').get()).toEqual({ hidden: 1 });
    expect((await hideOffer(db.sql, 'a@b', 10, true, 'špatná cena')).ok).toBe(true);
    expect(db.raw.prepare('SELECT active FROM offers WHERE id=10').get()).toEqual({ active: 0 });
    expect(db.raw.prepare('SELECT feed_id, external_id, reason FROM offer_blocklist').all()).toEqual([{ feed_id: 1, external_id: 'e10', reason: 'špatná cena' }]);
    expect((await hideOffer(db.sql, 'a@b', 10, false, '')).ok).toBe(true);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM offer_blocklist').get()).toEqual({ n: 0 });
    expect((await hideOffer(db.sql, 'a@b', 9999, true, 'x')).ok).toBe(false);
    expect(audits().map((a) => a.action)).toEqual(['hotel.hide', 'offer.hide', 'offer.unhide']);
  });
  it('save/replace/delete override, invalid input writes nothing', async () => {
    expect((await saveOverride(db.sql, 'a@b', { kind: 'landing', key: '/recko/', field: 'title', value: 'Řecko 2026' })).ok).toBe(true);
    expect((await saveOverride(db.sql, 'a@b', { kind: 'landing', key: '/recko/', field: 'title', value: 'Řecko 2027' })).ok).toBe(true);
    expect(db.raw.prepare("SELECT value FROM editorial_overrides WHERE key='/recko/'").all()).toEqual([{ value: 'Řecko 2027' }]);
    expect((await saveOverride(db.sql, 'a@b', { kind: 'landing', key: '/recko/', field: 'title', value: 'x'.repeat(61) })).ok).toBe(false);
    expect((await deleteOverride(db.sql, 'a@b', { kind: 'landing', key: '/recko/', field: 'title' })).ok).toBe(true);
    expect((await deleteOverride(db.sql, 'a@b', { kind: 'landing', key: '/recko/', field: 'title' })).ok).toBe(false);
  });
  it('triggerImport: no binding, paused feed, success and refusal', async () => {
    expect((await triggerImport(db.sql, 'a@b', undefined, undefined, 1)).ok).toBe(false);
    const calls: Array<{ url: string; auth: string | null; body: string }> = [];
    const importer = { fetch: (async (u: string, init: RequestInit) => { calls.push({ url: String(u), auth: new Headers(init.headers).get('authorization'), body: String(init.body) }); return new Response('{}', { status: 202 }); }) as unknown as typeof fetch };
    expect((await triggerImport(db.sql, 'a@b', importer, 's3cret', 2)).ok).toBe(false); // feed 2 is paused
    expect(calls).toHaveLength(0);
    expect((await triggerImport(db.sql, 'a@b', importer, 's3cret', 1)).ok).toBe(true);
    expect(calls).toEqual([{ url: 'https://importer.internal/run', auth: 'Bearer s3cret', body: '{"feed_id":1}' }]);
    const refusing = { fetch: (async () => new Response('no', { status: 401 })) as unknown as typeof fetch };
    expect((await triggerImport(db.sql, 'a@b', refusing, 'bad', 1)).ok).toBe(false);
  });
});

describe('admin authentication fails closed', () => {
  const r = (headers: Record<string, string> = {}) => new Request('https://kakapo.cz/admin/', { headers });
  it('no Access configuration -> 503 (staging/production)', async () => {
    expect(await authenticateAdmin(r(), { ENVIRONMENT: 'production' } as never)).toMatchObject({ ok: false, status: 503 });
  });
  it('configured but no JWT -> 401', async () => {
    expect(await authenticateAdmin(r(), { ENVIRONMENT: 'production', ACCESS_TEAM_DOMAIN: 't.cloudflareaccess.com', ACCESS_AUD: 'aud' } as never)).toMatchObject({ ok: false, status: 401 });
  });
  it('garbage JWT -> 403 (or 503 if certs unreachable), never ok', async () => {
    const res = await authenticateAdmin(r({ 'cf-access-jwt-assertion': 'a.b.c' }), { ENVIRONMENT: 'production', ACCESS_TEAM_DOMAIN: 't.cloudflareaccess.com', ACCESS_AUD: 'aud' } as never, (async () => new Response('{}', { status: 500 })) as never);
    expect(res.ok).toBe(false);
  });
  it('local bypass works only in local/test with the flag, never in production', async () => {
    expect((await authenticateAdmin(r(), { ENVIRONMENT: 'production', ADMIN_DEV_BYPASS: '1' } as never)).ok).toBe(false);
    expect((await authenticateAdmin(r(), { ENVIRONMENT: 'staging', ADMIN_DEV_BYPASS: '1' } as never)).ok).toBe(false);
    expect((await authenticateAdmin(r(), { ENVIRONMENT: 'local', ADMIN_DEV_BYPASS: '1' } as never)).ok).toBe(true);
    expect((await authenticateAdmin(r(), { ENVIRONMENT: 'local' } as never)).ok).toBe(false);
  });
  it('requireAdmin without configuration returns an error page, not content', async () => {
    stubEnv.ENVIRONMENT = 'production';
    const g = await requireAdmin(r());
    expect(g.ok).toBe(false);
    if (!g.ok) { expect(g.response.status).toBe(503); expect(g.response.headers.get('cache-control')).toBe('private, no-store'); }
  });
});

describe('Access JWT verification', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'k1' } as Jwk;
  const team = 't.cloudflareaccess.com';
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  function token(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'k1' }, key = privateKey) {
    const data = `${b64(header)}.${b64(payload)}`;
    return `${data}.${sign('RSA-SHA256', Buffer.from(data), key).toString('base64url')}`;
  }
  const now = Math.floor(Date.now() / 1000);
  const good = { iss: `https://${team}`, aud: ['aud1'], exp: now + 300, email: 'kenny@example.com' };
  const verify = (t: string) => verifyAccessJwt(t, { team, aud: 'aud1', jwks: [jwk] });
  it('accepts a valid token', async () => expect(await verify(token(good))).toEqual({ ok: true, email: 'kenny@example.com' }));
  it('rejects wrong audience, issuer, expired, not-yet-valid, wrong alg, bad signature', async () => {
    expect((await verify(token({ ...good, aud: ['other'] }))).ok).toBe(false);
    expect((await verify(token({ ...good, iss: 'https://evil.example' }))).ok).toBe(false);
    expect((await verify(token({ ...good, exp: now - 3600 }))).ok).toBe(false);
    expect((await verify(token({ ...good, nbf: now + 3600 }))).ok).toBe(false);
    expect((await verify(token(good, { alg: 'none', kid: 'k1' }))).ok).toBe(false);
    expect((await verify(token(good, { alg: 'HS256', kid: 'k1' }))).ok).toBe(false);
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    expect((await verify(token(good, { alg: 'RS256', kid: 'k1' }, other))).ok).toBe(false);
    expect((await verify(token(good, { alg: 'RS256', kid: 'unknown' }))).ok).toBe(false);
  });
});

describe('CSRF on admin POST', () => {
  const post = (headers: Record<string, string>, body: Record<string, string>) =>
    new Request('https://kakapo.cz/api/admin/feed', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body).toString() });
  beforeEach(() => { Object.assign(stubEnv, { ENVIRONMENT: 'test', ADMIN_DEV_BYPASS: '1', CSRF_SECRET: 'test-secret' }); });
  it('valid token + same origin passes', async () => {
    const t = await csrfToken('local-dev@localhost');
    const g = await requireAdminPost(post({ origin: 'https://kakapo.cz' }, { _csrf: t, feed_id: '1' }));
    expect(g.ok).toBe(true);
  });
  it('missing, wrong or foreign-user token is refused (403)', async () => {
    for (const t of ['', 'deadbeef', await csrfToken('someone-else@example.com')]) {
      const g = await requireAdminPost(post({ origin: 'https://kakapo.cz' }, { _csrf: t }));
      expect(g.ok).toBe(false);
      if (!g.ok) expect(g.response.status).toBe(403);
    }
  });
  it('cross-origin or origin-less POST is refused even with a valid token', async () => {
    const t = await csrfToken('local-dev@localhost');
    expect((await requireAdminPost(post({ origin: 'https://evil.example' }, { _csrf: t }))).ok).toBe(false);
    expect((await requireAdminPost(post({}, { _csrf: t }))).ok).toBe(false);
    expect(await verifyCsrf(post({ origin: 'https://evil.example' }, {}), 'local-dev@localhost', t)).toBe(false);
  });
  it('GET on a POST endpoint -> 405; unauthenticated POST -> auth error before any parsing', async () => {
    const g1 = await requireAdminPost(new Request('https://kakapo.cz/api/admin/feed'));
    expect(!g1.ok && g1.response.status).toBe(405);
    delete stubEnv.ADMIN_DEV_BYPASS;
    stubEnv.ENVIRONMENT = 'production';
    const g2 = await requireAdminPost(post({ origin: 'https://kakapo.cz' }, { _csrf: 'x' }));
    expect(!g2.ok && g2.response.status).toBe(503);
  });
});

describe('normalizePath', () => {
  it('lower-cases and adds trailing slash', () => expect(normalizePath('/A/B')).toEqual({ ok: true, value: '/a/b/' }));
  it.each(['a/', '//x', '/a b/', '/a?x', '/a#x', '/a\\b/'])('rejects %j', (p) => expect(normalizePath(p).ok).toBe(false));
});
