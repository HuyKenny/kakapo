/** Small helpers for API routes. */
export function json(data: unknown, init: ResponseInit & { cache?: 'public' | 'private' } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  if (!headers.has('cache-control')) headers.set('cache-control', init.cache === 'public' ? 'public, max-age=60' : 'private, no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function error(status: number, message: string): Response {
  return json({ error: message }, { status });
}

/** Same-origin check for state-changing requests: Origin (or Referer) host must equal the request host. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin') ?? request.headers.get('referer');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function readJson<T>(request: Request, maxBytes = 4096): Promise<T | null> {
  const ct = request.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) return null;
  const len = Number(request.headers.get('content-length') ?? '0');
  if (len > maxBytes) return null;
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i]! ^ eb[i]!;
  return diff === 0;
}

/** Crawlers, link previewers, monitors and headless tools — no statistics for them. */
const BOT_UA = /bot|crawl|spider|slurp|preview|fetch|monitor|headless|lighthouse|pingdom|uptime|curl|wget|python|httpclient|java\/|go-http|axios|node-fetch|okhttp|facebookexternalhit|embedly|whatsapp|telegram|discord|slack/i;
export function isBot(request: Request): boolean {
  const ua = request.headers.get('user-agent') ?? '';
  return !ua || BOT_UA.test(ua);
}
