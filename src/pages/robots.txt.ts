import type { APIRoute } from 'astro';
import { getEnv } from '../lib/server/env';
import robots from '../data/robots.txt?raw';

export const prerender = false;
// Production serves the same policy as the WordPress site; everything else is closed.
export const GET: APIRoute = () => {
  const prod = getEnv().ENVIRONMENT === 'production';
  return new Response(prod ? robots : 'User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain; charset=UTF-8', 'cache-control': 'public, max-age=3600' } });
};
