import type { APIRoute } from 'astro';
import { back, requireAdminPost } from '../../../lib/admin/guard';
import { hideHotel, hideOffer } from '../../../lib/admin/actions';
import { d1 } from '../../../lib/admin/sql';
import { getEnv } from '../../../lib/server/env';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const g = await requireAdminPost(request);
  if (!g.ok) return g.response;
  const db = d1(getEnv().DB);
  const id = Number(g.form.get('id'));
  const hide = String(g.form.get('hide') ?? '') === '1';
  const note = String(g.form.get('note') ?? '').trim();
  if (hide && !note) return back(request, '/admin/hotely/', { ok: false, message: 'U skrytí uveďte důvod.' });
  const type = String(g.form.get('type') ?? '');
  const r = type === 'hotel' ? await hideHotel(db, g.email, id, hide, note) : type === 'offer' ? await hideOffer(db, g.email, id, hide, note) : { ok: false as const, message: 'Neznámý typ.' };
  return back(request, '/admin/hotely/', r);
};
