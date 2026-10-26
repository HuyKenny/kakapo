import type { APIRoute } from 'astro';
import { getEnv, siteUrl } from '../lib/server/env';
import { rebuildSitemaps } from '../lib/sitemap';

export const prerender = false;
export const GET: APIRoute = async () => {
  const db = getEnv().DB;
  let row = await db.prepare("SELECT value FROM site_cache WHERE key='sitemap:index'").first<{ value: string }>();
  if (!row) { await rebuildSitemaps(db, siteUrl()); row = await db.prepare("SELECT value FROM site_cache WHERE key='sitemap:index'").first<{ value: string }>(); }
  return new Response(row?.value ?? '', { headers: { 'content-type': 'application/xml; charset=UTF-8', 'cache-control': 'public, max-age=900' } });
};
