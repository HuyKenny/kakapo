/** Defence in depth: every admin page and endpoint verifies the Access JWT itself (fail closed), independent of the middleware. */
import { authenticateAdmin } from '../server/access';
import { getEnv } from '../server/env';
import { verifyCsrf } from '../server/csrf';

export type Guard = { ok: true; email: string } | { ok: false; response: Response };

const page = (status: number, msg: string) => new Response(`<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Administrace</title><p>${msg.replace(/[<>&]/g, '')}</p>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' } });

export async function requireAdmin(request: Request): Promise<Guard> {
  const env = getEnv();
  const auth = await authenticateAdmin(request, env);
  if (!auth.ok) return { ok: false, response: page(auth.status, auth.reason) };
  if (request.method !== 'GET' && request.method !== 'HEAD' && env.RL_ADMIN && !(await env.RL_ADMIN.limit({ key: auth.email })).success) {
    return { ok: false, response: page(429, 'Příliš mnoho požadavků.') };
  }
  return { ok: true, email: auth.email };
}

/** Admin POST: auth + same-origin + CSRF token from the form. Returns the parsed form. */
export async function requireAdminPost(request: Request): Promise<{ ok: true; email: string; form: FormData } | { ok: false; response: Response }> {
  if (request.method !== 'POST') return { ok: false, response: page(405, 'Metoda není povolena.') };
  const g = await requireAdmin(request);
  if (!g.ok) return g;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, response: page(400, 'Neplatný formulář.') };
  }
  if (!(await verifyCsrf(request, g.email, String(form.get('_csrf') ?? '')))) return { ok: false, response: page(403, 'Neplatný bezpečnostní token. Načtěte stránku znovu.') };
  return { ok: true, email: g.email, form };
}

export function back(request: Request, path: string, r: { ok: boolean; message: string }): Response {
  const u = new URL(path, request.url);
  u.searchParams.set(r.ok ? 'ok' : 'err', r.message.slice(0, 300));
  return new Response(null, { status: 303, headers: { location: u.pathname + u.search, 'cache-control': 'private, no-store' } });
}
