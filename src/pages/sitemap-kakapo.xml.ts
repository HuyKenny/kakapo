import type { APIRoute } from 'astro';
import { getEnv } from '../lib/server/env';

export const prerender = false;
export const GET: APIRoute = async () => {
  const row = await getEnv().DB.prepare("SELECT value FROM site_cache WHERE key='sitemap:all'").first<{ value: string }>();
  if (!row) return new Response('Not found', { status: 404 });
  return new Response(row.value, { headers: { 'content-type': 'application/xml; charset=UTF-8', 'x-robots-tag': 'noindex', 'cache-control': 'public, max-age=900' } });
};
