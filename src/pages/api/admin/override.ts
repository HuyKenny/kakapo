import type { APIRoute } from 'astro';
import { back, requireAdminPost } from '../../../lib/admin/guard';
import { deleteOverride, saveOverride } from '../../../lib/admin/actions';
import { d1 } from '../../../lib/admin/sql';
import { getEnv } from '../../../lib/server/env';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const g = await requireAdminPost(request);
  if (!g.ok) return g.response;
  const db = d1(getEnv().DB);
  const f = { kind: String(g.form.get('kind') ?? ''), key: String(g.form.get('key') ?? ''), field: String(g.form.get('field') ?? '') };
  const r = String(g.form.get('action') ?? 'save') === 'delete' ? await deleteOverride(db, g.email, f) : await saveOverride(db, g.email, { ...f, value: String(g.form.get('value') ?? '') });
  return back(request, '/admin/texty/', r);
};
