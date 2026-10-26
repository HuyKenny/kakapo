// GET /api/search — JSON for the Alpine kakapoFilters component (same shape as WP REST /kakapo/v1/search).
import type { APIRoute } from 'astro';
import { getEnv } from '../../lib/server/env';
import { countryFlagUrl, imgUrl } from '../../lib/helpers';
import { apiHotel } from '../../lib/listing';
import { normalizeFilters, search } from '../../lib/search';

export const prerender = false;
const MAX_PAGE = 200;
const rawSrcset = (u: string, w: number) => { const one = imgUrl(u, w); return one === u ? '' : `${one} ${w}w, ${imgUrl(u, w * 2)} ${w * 2}w`; };

export const GET: APIRoute = async ({ url }) => {
  const params: Record<string, string> = {};
  for (const [k, v] of url.searchParams) if (v.length <= 200) params[k] = v;
  const f = normalizeFilters(params);
  if (f.page > MAX_PAGE) f.page = MAX_PAGE;
  const res = await search(getEnv().DB, f);
  const body = {
    hotels: res.hotels.map((h) => apiHotel(h, { imgUrl, imgSrcset: rawSrcset, flagUrl: countryFlagUrl })),
    total: res.total, pages: res.pages, page: res.page,
  };
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60', 'x-robots-tag': 'noindex' } });
};
