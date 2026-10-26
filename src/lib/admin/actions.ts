/** Admin write operations (runtime-agnostic; every one validates, writes and audits). */
import type { Sql } from './sql';
import { audit } from './audit';
import { validateOverride, validateRedirect } from './validate';

export type Result = { ok: true; message: string } | { ok: false; message: string };
const ok = (message: string): Result => ({ ok: true, message });
const fail = (message: string): Result => ({ ok: false, message });

export async function setFeedEnabled(db: Sql, actor: string, feedId: number, enabled: boolean): Promise<Result> {
  if (!Number.isInteger(feedId) || feedId <= 0) return fail('Neplatné ID feedu.');
  const r = await db.run('UPDATE feeds SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, feedId]);
  if (!r.changes) return fail('Feed neexistuje.');
  await audit(db, actor, enabled ? 'feed.resume' : 'feed.pause', `feed:${feedId}`);
  return ok(enabled ? `Feed ${feedId} je zapnutý.` : `Feed ${feedId} je pozastavený.`);
}

export async function hideHotel(db: Sql, actor: string, hotelId: number, hidden: boolean, note: string): Promise<Result> {
  const r = await db.run('UPDATE hotels SET hidden = ?, updated_at = ? WHERE id = ?', [hidden ? 1 : 0, new Date().toISOString(), hotelId]);
  if (!r.changes) return fail('Hotel neexistuje.');
  await audit(db, actor, hidden ? 'hotel.hide' : 'hotel.unhide', `hotel:${hotelId}`, note);
  return ok(hidden ? 'Hotel je skrytý.' : 'Hotel je znovu zveřejněný.');
}

/** Hiding sets active=0 AND records the offer in offer_blocklist, which the importer must honour. */
export async function hideOffer(db: Sql, actor: string, offerId: number, hidden: boolean, note: string): Promise<Result> {
  const o = await db.first<{ feed_id: number; external_id: string }>('SELECT feed_id, external_id FROM offers WHERE id = ?', [offerId]);
  if (!o) return fail('Nabídka neexistuje.');
  const now = new Date().toISOString();
  if (hidden) {
    await db.batch([
      { sql: 'UPDATE offers SET active = 0, updated_at = ? WHERE id = ?', params: [now, offerId] },
      { sql: 'INSERT OR REPLACE INTO offer_blocklist (feed_id, external_id, reason, actor, created_at) VALUES (?, ?, ?, ?, ?)', params: [o.feed_id, o.external_id, note.slice(0, 500), actor, now] },
    ]);
  } else {
    await db.run('DELETE FROM offer_blocklist WHERE feed_id = ? AND external_id = ?', [o.feed_id, o.external_id]);
    // the offer becomes active again with the next successful import of its feed
  }
  await audit(db, actor, hidden ? 'offer.hide' : 'offer.unhide', `offer:${offerId}`, note);
  return ok(hidden ? 'Nabídka je skrytá a import ji nevrátí.' : 'Blokace zrušena, nabídka se vrátí při dalším importu feedu.');
}

export async function saveOverride(db: Sql, actor: string, f: { kind: string; key: string; field: string; value: string }): Promise<Result> {
  const v = validateOverride(f.kind, f.key, f.field, f.value);
  if (!v.ok) return fail(v.error);
  const { kind, key, field, value } = v.value;
  await db.run(
    `INSERT INTO editorial_overrides (kind, key, field, value, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (kind, key, field) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [kind, key, field, value, new Date().toISOString()],
  );
  await audit(db, actor, 'override.save', `${kind}:${key}:${field}`, `${value.length} znaků`);
  return ok('Uloženo.');
}

export async function deleteOverride(db: Sql, actor: string, f: { kind: string; key: string; field: string }): Promise<Result> {
  const r = await db.run('DELETE FROM editorial_overrides WHERE kind = ? AND key = ? AND field = ?', [f.kind, f.key, f.field]);
  if (!r.changes) return fail('Záznam neexistuje.');
  await audit(db, actor, 'override.delete', `${f.kind}:${f.key}:${f.field}`);
  return ok('Smazáno.');
}

export async function saveRedirect(db: Sql, actor: string, from: string, to: string, status: number): Promise<Result> {
  const v = await validateRedirect(db, from, to, status);
  if (!v.ok) return fail(v.error);
  await db.run(
    `INSERT INTO redirects (from_path, to_path, status, reason, created_at) VALUES (?, ?, ?, 'manual', ?)
     ON CONFLICT (from_path) DO UPDATE SET to_path = excluded.to_path, status = excluded.status, reason = 'manual'`,
    [v.value.from, v.value.to, v.value.status, new Date().toISOString()],
  );
  await audit(db, actor, 'redirect.save', v.value.from, `${v.value.status} → ${v.value.to || '(410)'}`);
  return ok('Přesměrování uloženo.');
}

export async function deleteRedirect(db: Sql, actor: string, from: string): Promise<Result> {
  const r = await db.run('DELETE FROM redirects WHERE from_path = ?', [from]);
  if (!r.changes) return fail('Přesměrování neexistuje.');
  await audit(db, actor, 'redirect.delete', from);
  return ok('Přesměrování smazáno.');
}

/** Start an import through the IMPORTER service binding. Contract (importer side): POST /run {feed_id}, Bearer secret. */
export async function triggerImport(db: Sql, actor: string, importer: { fetch: typeof fetch } | undefined, secret: string | undefined, feedId: number): Promise<Result> {
  if (!Number.isInteger(feedId) || feedId <= 0) return fail('Neplatné ID feedu.');
  if (!importer || !secret) return fail('Importní Worker (binding IMPORTER) nebo IMPORT_SHARED_SECRET není nastaven.');
  const feed = await db.first<{ enabled: number }>('SELECT enabled FROM feeds WHERE id = ?', [feedId]);
  if (!feed) return fail('Feed neexistuje.');
  if (!feed.enabled) return fail('Feed je pozastavený. Nejdřív ho zapněte.');
  let res: Response;
  try {
    res = await importer.fetch('https://importer.internal/run', { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ feed_id: feedId }) });
  } catch {
    return fail('Importní Worker neodpověděl.');
  }
  await audit(db, actor, 'feed.run', `feed:${feedId}`, `HTTP ${res.status}`);
  return res.ok ? ok(`Import feedu ${feedId} byl spuštěn.`) : fail(`Import odmítl požadavek (HTTP ${res.status}).`);
}
