// Guarded HTTP download for partner feeds: https only, host allow-list also for every redirect hop,
// conditional requests (ETag / Last-Modified), timeout + bounded retry with exponential backoff.
// URLs carry tokens: they are never logged and never put into error messages.
import type { Deps } from '../deps';

export class FeedFetchError extends Error {
  constructor(message: string, public retryable: boolean) { super(message); this.name = 'FeedFetchError'; }
}

export function hostAllowed(host: string, list: string | undefined): boolean {
  const h = host.toLowerCase();
  if (!list) return false;
  return list.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).some((rule) =>
    rule.startsWith('*.') ? h.endsWith(rule.slice(1)) && h.length > rule.length - 1 : h === rule);
}

const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$|172\.(1[6-9]|2\d|3[01])\.)/i;

function checkUrl(u: URL, allowed: string | undefined) {
  if (u.protocol !== 'https:') throw new FeedFetchError('feed host must use https', false);
  if (PRIVATE.test(u.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) throw new FeedFetchError('feed host is not a public name', false);
  if (!hostAllowed(u.hostname, allowed)) throw new FeedFetchError(`host ${u.hostname} is not on the allow-list`, false);
}

export type OpenResult = { status: 'not_modified' } | { status: 'ok'; body: ReadableStream<Uint8Array>; etag: string | null; lastModified: string | null };

export async function openHttp(deps: Deps, url: string, cond: { etag?: string | null; lastModified?: string | null }, opts: { timeoutMs?: number; attempts?: number } = {}): Promise<OpenResult> {
  const attempts = opts.attempts ?? 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await once(deps, url, cond, opts.timeoutMs ?? 240_000);
    } catch (e) {
      lastErr = e;
      if (e instanceof FeedFetchError && !e.retryable) throw e;
      if (attempt < attempts) await deps.sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw lastErr instanceof FeedFetchError ? lastErr : new FeedFetchError('download failed after retries', false);
}

async function once(deps: Deps, start: string, cond: { etag?: string | null; lastModified?: string | null }, timeoutMs: number): Promise<OpenResult> {
  let u: URL;
  try { u = new URL(start); } catch { throw new FeedFetchError('feed URL is invalid', false); }
  // Some partner URLs were configured as http:// in WordPress; always fetch them over TLS (a redirect back to http is still refused).
  if (u.protocol === 'http:') u.protocol = 'https:';
  const allowed = deps.env.ALLOWED_FEED_HOSTS;
  const headers: Record<string, string> = { 'User-Agent': 'KakapoFeedImporter/1.0 (+https://kakapo.cz)', 'Accept-Encoding': 'gzip' };
  if (cond.etag) headers['If-None-Match'] = cond.etag;
  if (cond.lastModified) headers['If-Modified-Since'] = cond.lastModified;
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop <= 5; hop++) {
    checkUrl(u, allowed);
    let res: Response;
    try { res = await deps.fetch(u.toString(), { headers, redirect: 'manual', signal }); }
    catch { throw new FeedFetchError('network error or timeout', true); }
    if (res.status === 304) return { status: 'not_modified' };
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new FeedFetchError(`redirect without location (HTTP ${res.status})`, false);
      try { u = new URL(loc, u); } catch { throw new FeedFetchError('redirect target is invalid', false); }
      continue; // allow-list is re-checked at the top of the loop
    }
    if (res.status === 429 || res.status >= 500) throw new FeedFetchError(`HTTP ${res.status}`, true);
    if (!res.ok || !res.body) throw new FeedFetchError(`HTTP ${res.status}`, false);
    return { status: 'ok', body: res.body, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
  }
  throw new FeedFetchError('too many redirects', false);
}
