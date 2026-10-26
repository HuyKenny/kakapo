import type { APIRoute } from 'astro';
import { getEnv } from '../lib/server/env';

export const prerender = false;
export const GET: APIRoute = async () => {
  const db = getEnv().DB;
  // built by the import Worker (afterRun) or scripts/build-sitemaps.ts — never inside a visitor request (it takes minutes)
  const row = await db.prepare("SELECT value FROM site_cache WHERE key='sitemap:index'").first<{ value: string }>();
  if (!row) return new Response('Sitemap is being built', { status: 503, headers: { 'retry-after': '600', 'cache-control': 'no-store' } });
  return new Response(row.value, { headers: { 'content-type': 'application/xml; charset=UTF-8', 'cache-control': 'public, max-age=900' } });
};
