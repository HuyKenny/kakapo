import type { APIRoute } from 'astro';
import { back, requireAdminPost } from '../../../lib/admin/guard';
import { deleteRedirect, saveRedirect } from '../../../lib/admin/actions';
import { d1 } from '../../../lib/admin/sql';
import { getEnv } from '../../../lib/server/env';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const g = await requireAdminPost(request);
  if (!g.ok) return g.response;
  const db = d1(getEnv().DB);
  const from = String(g.form.get('from') ?? '');
  const r = String(g.form.get('action') ?? 'save') === 'delete' ? await deleteRedirect(db, g.email, from) : await saveRedirect(db, g.email, from, String(g.form.get('to') ?? ''), Number(g.form.get('status') ?? 301));
  return back(request, '/admin/presmerovani/', r);
};
