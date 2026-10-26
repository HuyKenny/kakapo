// GET /api/filters — facet counts for the current filters (zero filters → global snapshot).
import type { APIRoute } from 'astro';
import { getEnv } from '../../lib/server/env';
import { facets } from '../../lib/listing/facets';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const params: Record<string, string> = {};
  for (const [k, v] of url.searchParams) if (v.length <= 200) params[k] = v;
  const body = await facets(getEnv().DB, params);
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60', 'x-robots-tag': 'noindex' } });
};
