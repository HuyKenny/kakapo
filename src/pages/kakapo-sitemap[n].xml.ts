import type { APIRoute } from 'astro';
import { getEnv } from '../lib/server/env';

export const prerender = false;
export const GET: APIRoute = async ({ params }) => {
  const n = Number(params.n);
  if (!Number.isInteger(n) || n < 1) return new Response('Not found', { status: 404 });
  const row = await getEnv().DB.prepare('SELECT value FROM site_cache WHERE key = ?').bind(`sitemap:${n}`).first<{ value: string }>();
  if (!row) return new Response('Not found', { status: 404, headers: { 'cache-control': 'public, max-age=300' } });
  return new Response(row.value, { headers: { 'content-type': 'application/xml; charset=UTF-8', 'cache-control': 'public, max-age=900' } });
};
