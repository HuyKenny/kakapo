/**
 * Every on-demand request:
 *  1. host allow-list (staging/preview hosts other than ALLOWED_HOSTS → 404)
 *  2. staging: whole host behind Access
 *  3. admin + admin API: Access JWT (fail closed), private no-store
 *  4. trailing-slash canonicalisation, legacy 301s (/dovolena/ …) and D1 `redirects` (merged hotels, manual)
 *  5. edge cache (Cache API) for public GET HTML. Key = host + path + whitelisted params + data_version + build id.
 *     Never for /go, /akce, /api/admin, /admin; never when Authorization is present.
 *  6. security headers; non-production hosts get X-Robots-Tag noindex.
 */
import { defineMiddleware } from 'astro:middleware';
import { authenticateAdmin } from './lib/server/access';
import { allowedHosts, d1Stats, getEnv, isLocal } from './lib/server/env';
import { clientIp, error } from './lib/server/http';
import { dataVersion, invalidateVersionMemo } from './lib/server/versions';
import { securityHeaders } from './lib/security';

/** Query params that change the rendered content (everything else, e.g. utm_*, fbclid, does not split the cache). */
const CONTENT_PARAMS = new Set(['country', 'country_exclude', 'dest', 'city', 'q', 'theme', 'stars', 'meal', 'airport', 'partner', 'price_min', 'price_max', 'nights_min', 'nights_max', 'rating_min', 'date_from', 'date_to', 'transport', 'flag', 'adults', 'sort', 'page', 'strana', 'typ', 'kategorie']);
const NO_CACHE = [/^\/admin\b/, /^\/api\/admin\//, /^\/go\//, /^\/akce\//, /^\/goproduct\//];
const CACHE_TTL = 600; // data_version changes the key after imports (at most every 20 min), so a longer TTL never serves stale prices for long

const LEGACY: Array<[RegExp, string]> = [
  [/^\/(wp-)?sitemap\.xml$/, '/sitemap_index.xml'],
  [/^\/favicon\.ico$/, '/wp-content/kakapo-assets/img/favicon-32.png'],
  [/^\/ads\.txt$/, '/'],
  [/^\/dovolena\/?$/, '/zajezdy/'],
  [/^\/dovolena-i-more\/?$/, '/dovolena-u-more/'],
  [/^\/vlastni-dopravou\/?$/, '/dovolena-vlastni-dopravou/'],
];

export function cacheKey(url: URL, version: string): string | null {
  const sp = new URLSearchParams();
  const entries = [...url.searchParams.entries()].filter(([k]) => CONTENT_PARAMS.has(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length > 12) return null;
  for (const [k, v] of entries) {
    if (v.length > 120) return null;
    sp.append(k, k === 'q' ? v.trim().toLowerCase() : v);
  }
  // Everything that splits the cache goes into the PATH: the zone's (WordPress-era) cache rule strips query strings from cache keys.
  const q = sp.toString();
  return `https://${url.host}/__kc/${encodeURIComponent(version)}/${__BUILD_ID__}${url.pathname}${q ? '__q/' + encodeURIComponent(q) : ''}`;
}

function finish(res: Response, url: URL, extra: Record<string, string> = {}): Response {
  const out = new Response(res.body, res);
  const env = getEnv();
  for (const [k, v] of Object.entries(securityHeaders(env.ANALYTICS_ENABLED === '1'))) if (!out.headers.has(k)) out.headers.set(k, v);
  for (const [k, v] of Object.entries(extra)) out.headers.set(k, v);
  if (env.ENVIRONMENT !== 'production' || /^\/(admin|api\/admin|go|akce)\b/.test(url.pathname)) out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  if (env.ENVIRONMENT !== 'production') { out.headers.set('X-D1-Queries', String(d1Stats.n)); out.headers.set('X-D1-Ms', String(d1Stats.ms)); if (d1Stats.slow.length) out.headers.set('X-D1-Slow', encodeURIComponent(d1Stats.slow.join(' || '))); }
  return out;
}
const redirect = (to: string, status = 301) => new Response(null, { status, headers: { location: to, 'cache-control': 'public, max-age=3600' } });

export const onRequest = defineMiddleware(async (ctx, next) => {
  const url = ctx.url;
  if (ctx.isPrerendered) return next();
  d1Stats.n = 0; d1Stats.ms = 0; d1Stats.slow = [];
  const env = getEnv();

  // www → apex (the WordPress site did the same)
  if (env.ENVIRONMENT === 'production' && url.hostname.toLowerCase() === 'www.kakapo.cz') return redirect('https://kakapo.cz' + url.pathname + url.search, 301);

  const hosts = allowedHosts(env);
  if (!isLocal(env) && hosts.length && !hosts.includes(url.hostname.toLowerCase())) {
    return finish(new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } }), url);
  }

  const isGet = ctx.request.method === 'GET' || ctx.request.method === 'HEAD';
  const isAdmin = url.pathname.startsWith('/admin') || url.pathname.startsWith('/api/admin');

  if (env.REQUIRE_ACCESS_EVERYWHERE === '1' && !isAdmin) {
    const auth = await authenticateAdmin(ctx.request, env);
    if (!auth.ok) return finish(new Response('Přístup jen pro přihlášené.', { status: auth.status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } }), url);
  }

  if (isAdmin) {
    const auth = await authenticateAdmin(ctx.request, env);
    if (!auth.ok) {
      return finish(url.pathname.startsWith('/api/') ? error(auth.status, auth.reason) : new Response(`<!doctype html><meta charset="utf-8"><title>Administrace</title><p>${auth.reason}</p>`, { status: auth.status, headers: { 'content-type': 'text/html; charset=utf-8' } }), url, { 'Cache-Control': 'private, no-store' });
    }
    if (ctx.request.method !== 'GET' && env.RL_ADMIN && !(await env.RL_ADMIN.limit({ key: auth.email })).success) return finish(error(429, 'Příliš mnoho požadavků.'), url);
    ctx.locals.adminEmail = auth.email;
    const res = await next();
    if (ctx.request.method !== 'GET') invalidateVersionMemo();
    return finish(res, url, { 'Cache-Control': 'private, no-store' });
  }

  if (isGet) {
    // canonical trailing slash for pages (files like /sitemap_index.xml, /robots.txt and /wp-content/... keep theirs)
    if (!url.pathname.endsWith('/') && !/\.[a-z0-9]{2,5}$/i.test(url.pathname) && !url.pathname.startsWith('/api/')) {
      return finish(redirect(url.pathname + '/' + url.search, 301), url);
    }
    if (url.pathname === '/' && url.searchParams.has('s')) return finish(redirect('/zajezdy/' + (url.searchParams.get('s') ? '?q=' + encodeURIComponent(url.searchParams.get('s')!.slice(0, 100)) : ''), 301), url);
    for (const [re, to] of LEGACY) if (re.test(url.pathname)) return finish(redirect(to + url.search), url);
    if (!NO_CACHE.some((r) => r.test(url.pathname)) && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/wp-content/')) {
      try {
        const r = await env.DB.prepare('SELECT to_path, status FROM redirects WHERE from_path = ?').bind(url.pathname.toLowerCase()).first<{ to_path: string; status: number }>();
        if (r) return finish(r.status === 410 ? new Response('Gone', { status: 410, headers: { 'cache-control': 'public, max-age=3600' } }) : redirect(r.to_path + url.search, r.status), url);
      } catch { /* a DB hiccup must not break pages */ }
    }
  }

  const cacheableApi = /^\/api\/(search|filters)\/?$/.test(url.pathname); // JSON for the filters UI, same params as the listings
  const cacheable = isGet && !NO_CACHE.some((r) => r.test(url.pathname)) && (!url.pathname.startsWith('/api/') || cacheableApi) && !ctx.request.headers.has('authorization') && env.REQUIRE_ACCESS_EVERYWHERE !== '1';
  const cache = cacheable && typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : null;
  let key: string | null = null;
  if (cache) {
    try {
      key = cacheKey(url, await dataVersion());
      if (key) { const hit = await cache.match(key); if (hit) return finish(hit, url, cacheableApi ? { 'X-Kakapo-Page-Cache': 'HIT', 'Cache-Control': 'public, max-age=60' } : { 'X-Kakapo-Page-Cache': 'HIT', 'Cache-Control': 'public, max-age=0, must-revalidate' }); }
    } catch { key = null; }
  }

  if (url.pathname.startsWith('/api/search') && env.RL_SEARCH && !(await env.RL_SEARCH.limit({ key: clientIp(ctx.request) })).success) {
    return finish(new Response('Příliš mnoho vyhledávání, zkuste to za chvíli.', { status: 429, headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '30' } }), url);
  }

  const res = await next();
  const cc = res.headers.get('cache-control') ?? '';
  const isHtml = (res.headers.get('content-type') ?? '').includes('text/html');
  const isApiJson = cacheableApi && (res.headers.get('content-type') ?? '').includes('application/json');
  if (cache && key && res.status === 200 && (isHtml || isApiJson) && !res.headers.has('set-cookie') && !/private|no-store/.test(cc)) {
    const toStore = new Response(res.clone().body, res);
    toStore.headers.set('Cache-Control', `public, s-maxage=${CACHE_TTL}`);
    const put = cache.put(key, toStore).catch((e: unknown) => console.log('cache.put failed: ' + String(e)));
    if (ctx.locals.cfContext?.waitUntil) ctx.locals.cfContext.waitUntil(put); else await put;
    return finish(res, url, isApiJson ? { 'X-Kakapo-Page-Cache': 'MISS', 'Cache-Control': 'public, max-age=60' } : { 'X-Kakapo-Page-Cache': 'MISS', 'Cache-Control': 'public, max-age=0, must-revalidate' });
  }
  if (isHtml && !res.headers.has('cache-control')) return finish(res, url, { 'Cache-Control': 'public, max-age=0, must-revalidate' });
  return finish(res, url);
});
