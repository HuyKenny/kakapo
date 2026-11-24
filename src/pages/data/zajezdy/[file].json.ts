// GET /data/zajezdy/index.json and /data/zajezdy/<country>.json — listing data for the client-side filters of the frozen
// (static) site. Rendered once per build over the local D1 copy and saved as static files by scripts/static/zmraz.py
// (paths come from site.json crawl.extra_paths_sql); production never runs this code.
import type { APIRoute } from 'astro';
import { getEnv } from '../../../lib/server/env';
import { buildIndex, buildShard } from '../../../lib/listing/static-data';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=600', 'x-robots-tag': 'noindex' },
});

export const GET: APIRoute = async ({ params }) => {
  const db = getEnv().DB;
  const file = String(params.file ?? '');
  if (file === 'index') return json(await buildIndex(db));
  const shard = await buildShard(db, file);
  return shard ? json(shard) : json({ error: 'not found' }, 404);
};
