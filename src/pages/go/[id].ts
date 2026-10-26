/** /go/{offerId}/ — affiliate exit for hotel offers. Logic and security rules live in lib/server/clicks.ts. */
import type { APIRoute } from 'astro';
import { handleGo } from '../../lib/server/clicks';
import { getEnv } from '../../lib/server/env';
import { d1 } from '../../lib/admin/sql';

export const prerender = false;

export const GET: APIRoute = ({ params, request, locals }) => {
  const env = getEnv();
  return handleGo({ kind: 'offer', rawId: params.id, request, env, db: d1(env.DB), waitUntil: (p) => locals.cfContext?.waitUntil(p) });
};
