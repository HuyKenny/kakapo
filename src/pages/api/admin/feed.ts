import type { APIRoute } from 'astro';
import { back, requireAdminPost } from '../../../lib/admin/guard';
import { setFeedEnabled, triggerImport } from '../../../lib/admin/actions';
import { d1 } from '../../../lib/admin/sql';
import { getEnv } from '../../../lib/server/env';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const g = await requireAdminPost(request);
  if (!g.ok) return g.response;
  const env = getEnv();
  const db = d1(env.DB);
  const id = Number(g.form.get('feed_id'));
  const action = String(g.form.get('action') ?? '');
  const r =
    action === 'pause' ? await setFeedEnabled(db, g.email, id, false)
    : action === 'resume' ? await setFeedEnabled(db, g.email, id, true)
    : action === 'run' ? await triggerImport(db, g.email, env.IMPORTER, env.IMPORT_SHARED_SECRET, id)
    : { ok: false as const, message: 'Neznámá akce.' };
  return back(request, '/admin/', r);
};
