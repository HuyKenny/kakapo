/**
 * Affiliate exits /go/{offerId}/ and /akce/{productId}/.
 *  - the target comes ONLY from D1 (never from the request), is returned byte for byte as stored (signed CJ/ehub
 *    links must not be re-encoded or reordered) and must be https on an allow-listed partner host (no open redirect);
 *  - the answer is never shared-cached (302 private, no-store) so no visitor identifier can leak through a cache;
 *  - crawlers/prefetch get a 204 without any write; real clicks are logged in waitUntil, so analytics or D1 write
 *    failures never block the redirect.
 */
import { sha256Hex } from './http';
import { isLocal, type AppEnv } from './env';
import type { Sql } from '../admin/sql';

export type GoKind = 'offer' | 'product';

/** Hosts we may redirect to: CJ click domains and the direct partner/network hosts present in the catalogue. */
export const DEFAULT_ALLOWED_HOSTS = [
  'anrdoezrs.net', 'jdoqocy.com', 'tkqlhce.com', 'dpbolvw.net', 'kqzyfj.com', // CJ
  'invia.cz', 'dovolena.cz', 'slevomat.cz', 'ehub.cz', 'radynacestu.cz', 'cedok.cz', 'fischer.cz', 'exim.cz', 'blue-style.cz', 'tui.cz',
];

export function allowedHosts(env: { GO_ALLOWED_HOSTS?: string }): string[] {
  const extra = (env.GO_ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return [...DEFAULT_ALLOWED_HOSTS, ...extra];
}

/** https only, no credentials in the URL, host equal to or a subdomain of an allow-listed host, header-safe characters. */
export function isSafeTarget(url: unknown, hosts: string[]): url is string {
  if (typeof url !== 'string' || url.length === 0 || url.length > 8192) return false;
  if (!/^[\x21-\x7e]+$/.test(url)) return false; // printable ASCII, no spaces/control chars/CRLF
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  return hosts.some((h) => host === h || host.endsWith('.' + h));
}

const CRAWLER_NEEDLES = [
  'ahrefsbot', 'amazonbot', 'amzn-searchbot', 'baiduspider', 'bingbot', 'blexbot', 'curl/', 'dataforseobot', 'dotbot', 'duckduckbot',
  'facebookexternalhit', 'googlebot', 'iboubot', 'mj12bot', 'petalbot', 'python-requests', 'semrushbot', 'serpstatbot', 'slurp', 'yandexbot',
  'aliyun', 'alibaba', 'bytespider', 'headless', 'wget', 'go-http-client', 'java/', 'okhttp', 'axios', 'node-fetch', 'scrapy', 'httpclient',
];
const BOT_RE = /bot\b|crawl|spider|preview|monitor|lighthouse|pingdom|uptime|whatsapp|telegram|discord|slack/i;

export function isCrawlerLike(ua: string | null | undefined): boolean {
  const s = (ua ?? '').toLowerCase().trim();
  if (!s) return true;
  return CRAWLER_NEEDLES.some((n) => s.includes(n)) || BOT_RE.test(s);
}

export function isPrefetch(request: Request): boolean {
  return request.headers.get('purpose') === 'prefetch' || (request.headers.get('sec-purpose') ?? '').includes('prefetch');
}

export function sanitizeContext(v: string | null): string {
  return (v ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30) || 'go';
}

/** Daily-salted hash of the IP; the raw address is never stored. Without a salt (and outside local) nothing is stored. */
export async function ipHash(ip: string, env: AppEnv, now = new Date()): Promise<string> {
  const salt = env.IP_HASH_SALT || (isLocal(env) ? 'local-salt' : '');
  if (!salt) return '';
  return (await sha256Hex(`${salt}|${now.toISOString().slice(0, 10)}|${ip}`)).slice(0, 32);
}

const NO_STORE: Record<string, string> = {
  'cache-control': 'private, no-store, max-age=0',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'strict-origin-when-cross-origin',
};
const text = (status: number, body: string, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { ...NO_STORE, 'content-type': 'text/plain; charset=utf-8', ...extra } });

interface Row { id: number; affiliate_url: string; partner_slug: string; hotel_id: number; hotel_slug: string | null; ok: number }

async function lookup(db: Sql, kind: GoKind, id: number): Promise<Row | null> {
  if (kind === 'offer') {
    return db.first<Row>(
      `SELECT o.id, o.affiliate_url, o.partner_slug, o.hotel_id, h.slug AS hotel_slug,
              CASE WHEN o.active = 1 AND h.hidden = 0 THEN 1 ELSE 0 END AS ok
       FROM offers o LEFT JOIN hotels h ON h.id = o.hotel_id WHERE o.id = ?`, [id]);
  }
  return db.first<Row>(
    `SELECT id, affiliate_url, partner_slug, 0 AS hotel_id, NULL AS hotel_slug,
            CASE WHEN active = 1 AND hidden = 0 THEN 1 ELSE 0 END AS ok FROM products WHERE id = ?`, [id]);
}

export async function handleGo(args: {
  kind: GoKind; rawId: string | undefined; request: Request; env: AppEnv & { GO_ALLOWED_HOSTS?: string };
  db: Sql; waitUntil?: (p: Promise<unknown>) => void;
}): Promise<Response> {
  const { kind, rawId, request, env, db } = args;
  if (!rawId || !/^[1-9]\d{0,11}$/.test(rawId)) return text(404, 'Nabídka neexistuje.');
  const id = Number(rawId);

  if (isCrawlerLike(request.headers.get('user-agent')) || isPrefetch(request)) {
    return new Response(null, { status: 204, headers: { ...NO_STORE, 'cache-control': 'public, max-age=3600', 'x-kakapo-go': 'bot-skip' } });
  }
  const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
  if (env.RL_GO && !(await env.RL_GO.limit({ key: ip })).success) {
    return text(429, 'Příliš mnoho požadavků, zkuste to za chvíli.', { 'retry-after': '60' });
  }

  const row = await lookup(db, kind, id);
  // unknown/expired ids (e.g. offers that ended before the migration): send people to the listing instead of a dead end
  if (!row) return new Response(null, { status: 302, headers: { ...NO_STORE, location: '/zajezdy/', 'x-kakapo-go': 'gone' } });
  const fallback = row.hotel_slug && /^[a-z0-9-]+$/.test(row.hotel_slug) ? `/hotel/${row.hotel_slug}/` : null;
  const redirectToFallback = () => (fallback ? new Response(null, { status: 302, headers: { ...NO_STORE, location: fallback, 'x-kakapo-go': 'fallback' } }) : text(404, 'Nabídka neexistuje nebo již skončila.'));
  if (!row.ok) return redirectToFallback();
  if (!isSafeTarget(row.affiliate_url, allowedHosts(env))) {
    console.log(JSON.stringify({ level: 'error', event: 'go_unsafe_target', kind, id }));
    return redirectToFallback();
  }

  const click = (async () => {
    const hash = await ipHash(ip, env);
    await db.run(
      `INSERT INTO clicks (offer_id, hotel_id, product_id, partner_slug, context, ip_hash, clicked_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [kind === 'offer' ? row.id : 0, row.hotel_id, kind === 'product' ? row.id : 0, row.partner_slug, sanitizeContext(new URL(request.url).searchParams.get('ctx')), hash, new Date().toISOString()],
    );
  })().catch((e) => console.log(JSON.stringify({ level: 'warn', event: 'click_log_failed', message: e instanceof Error ? e.message : String(e) })));
  args.waitUntil?.(click);

  return new Response(null, { status: 302, headers: { ...NO_STORE, location: row.affiliate_url, 'x-kakapo-go': 'd1' } });
}
