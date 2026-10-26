// Offer and product upserts. No SELECT per item: one lookup per ≤80 external ids, then classification by content hash.
// Unchanged rows are not written at all (no last_seen churn); presence in a full feed is tracked by the run manifest.
import type { Db, D1Stmt, D1Result } from '../deps';
import type { NormOffer, NormProduct } from '../model';
import { addDays, slugify, stableHash } from '../util/text';
import { BATCH_SIZE, chunk, selectIn, parseJson } from './db';

export interface RunCtx { runId: number; nowSql: string; today: string; lmDays: number; firstMinuteDays: number }
export interface ApplyStats { created: number; changed: number; unchanged: number; stale: number; duplicates: number; deletedElsewhere: number }
const zero = (): ApplyStats => ({ created: 0, changed: 0, unchanged: 0, stale: 0, duplicates: 0, deletedElsewhere: 0 });

export const offerHash = (o: NormOffer): string => stableHash([o.title, o.price_pp, o.price_total, o.price_original, o.currency, o.price_basis, o.departure_date, o.return_date, o.nights, o.meal_type, o.transport, o.airport, o.arrival_airport, o.room_type, o.adults, o.children, o.availability, o.affiliate_url, o.image_url]);
export const productHash = (p: NormProduct): string => stableHash([p.title, p.description, p.price, p.currency, p.country, p.destination, p.place, p.nights, p.date_from, p.date_to, p.meal, p.transport, p.affiliate_url, p.type, p.type_raw, JSON.stringify(p.terms), JSON.stringify(p.images)]);

/** Run statements in batches and return per-statement results (D1 runs each batch in one transaction). */
export async function runDetailed(db: Db, stmts: D1Stmt[]): Promise<D1Result[]> {
  const out: D1Result[] = [];
  for (const part of chunk(stmts, BATCH_SIZE)) out.push(...(await db.batch(part)));
  return out;
}

interface OfferRow { id: number; hotel_id: number; feed_id: number; external_id: string; content_hash: string; active: number; seen_run: number }

export async function applyOffers(db: Db, feed: { id: number; partner_slug: string }, items: Array<{ hotelId: number; offer: NormOffer }>, run: RunCtx): Promise<ApplyStats> {
  const stats = zero();
  const last = new Map<string, { hotelId: number; offer: NormOffer }>();
  for (const it of items) { if (last.has(it.offer.external_id)) stats.duplicates++; last.set(it.offer.external_id, it); }
  const rows = await selectIn<OfferRow>(db, 'SELECT id, hotel_id, feed_id, external_id, content_hash, active, seen_run FROM offers WHERE partner_slug = ? AND external_id IN ({IN})', [...last.keys()], [feed.partner_slug]);
  const byExt = new Map<string, OfferRow[]>();
  for (const r of rows) (byExt.get(r.external_id) ?? byExt.set(r.external_id, []).get(r.external_id)!).push(r);

  const lmLimit = addDays(run.today, run.lmDays), fmLimit = addDays(run.today, run.firstMinuteDays);
  const stmts: D1Stmt[] = []; const kinds: Array<'new' | 'upd' | 'del'> = [];
  for (const [ext, { hotelId, offer: o }] of last) {
    if (!hotelId) continue;
    const found = byExt.get(ext) ?? [];
    for (const other of found.filter((r) => r.feed_id !== feed.id)) { stmts.push(db.prepare('DELETE FROM offers WHERE id = ?').bind(other.id)); kinds.push('del'); stats.deletedElsewhere++; }
    const own = found.find((r) => r.feed_id === feed.id);
    const hash = offerHash(o);
    if (own && own.content_hash === hash && own.active === 1 && own.hotel_id === hotelId) { stats.unchanged++; continue; }
    const lm = o.departure_date <= lmLimit ? 1 : 0, fm = o.departure_date >= fmLimit ? 1 : 0;
    const f = [o.title, o.price_pp, o.price_total, o.price_original, o.currency, o.price_basis, o.departure_date, o.return_date, o.nights, Math.max(2, o.nights + 1), o.meal_type, o.transport, o.airport, slugify(o.airport), o.arrival_airport, o.room_type, o.adults, o.children, o.availability, lm, fm, o.affiliate_url, o.image_url];
    if (!own) {
      stmts.push(db.prepare(`INSERT INTO offers (hotel_id,feed_id,partner_slug,external_id,content_hash,title,price_pp,price_total,price_original,currency,price_basis,departure_date,return_date,nights,days,meal_type,transport,airport,airport_slug,arrival_airport,room_type,adults,children,availability,is_last_minute,is_first_minute,affiliate_url,image_url,active,seen_run,last_seen,created_at,updated_at)
        VALUES (?,?,?,?,?,${'?,'.repeat(23).slice(0, -1)},1,?,?,?,?)`).bind(hotelId, feed.id, feed.partner_slug, ext, hash, ...f, run.runId, run.nowSql, run.nowSql, run.nowSql));
      kinds.push('new');
    } else {
      stmts.push(db.prepare(`UPDATE offers SET hotel_id=?, content_hash=?, prev_price_pp = CASE WHEN price_pp <> ? THEN price_pp ELSE prev_price_pp END,
        price_changed_at = CASE WHEN price_pp <> ? THEN ? ELSE price_changed_at END,
        title=?, price_pp=?, price_total=?, price_original=?, currency=?, price_basis=?, departure_date=?, return_date=?, nights=?, days=?, meal_type=?, transport=?, airport=?, airport_slug=?, arrival_airport=?, room_type=?, adults=?, children=?, availability=?, is_last_minute=?, is_first_minute=?, affiliate_url=?, image_url=?,
        active=1, seen_run=?, last_seen=?, updated_at=? WHERE id=? AND seen_run <= ?`).bind(hotelId, hash, o.price_pp, o.price_pp, run.nowSql, ...f, run.runId, run.nowSql, run.nowSql, own.id, run.runId));
      kinds.push('upd');
    }
  }
  const res = await runDetailed(db, stmts);
  res.forEach((r, i) => {
    if (kinds[i] === 'new') stats.created++;
    else if (kinds[i] === 'upd') { if ((r.meta.changes ?? 0) > 0) stats.changed++; else stats.stale++; } // 0 rows = a newer run already wrote it
  });
  return stats;
}

interface ProductRow { id: number; content_hash: string; active: number; meta_json: string | null; images_json: string | null; seen_run: number }

export async function applyProducts(db: Db, feed: { id: number; partner_slug: string }, items: NormProduct[], run: RunCtx): Promise<ApplyStats> {
  const stats = zero();
  const last = new Map<string, NormProduct>();
  for (const p of items) { if (last.has(p.external_id)) stats.duplicates++; last.set(p.external_id, p); }
  const rows = await selectIn<ProductRow & { external_id: string }>(db, 'SELECT id, external_id, content_hash, active, meta_json, images_json, seen_run FROM products WHERE feed_id = ? AND external_id IN ({IN})', [...last.keys()], [feed.id]);
  const byExt = new Map(rows.map((r) => [r.external_id, r]));
  const newOnes = [...last.values()].filter((p) => !byExt.has(p.external_id));
  const taken = new Set((await selectIn<{ slug: string }>(db, 'SELECT slug FROM products WHERE slug IN ({IN})', newOnes.map((p) => slugify(`${p.title} ${p.country}`).slice(0, 180) || 'nabidka'))).map((r) => r.slug));
  const stmts: D1Stmt[] = []; const upd: boolean[] = [];
  for (const [ext, p] of last) {
    const own = byExt.get(ext);
    const hash = productHash(p);
    if (own && own.content_hash === hash && own.active === 1) { stats.unchanged++; continue; }
    let images = p.images;
    const meta: Record<string, unknown> = { terms: p.terms, dates: p.terms.map((t) => t.from) };
    if (own && parseJson<{ gallery_enriched?: number }>(own.meta_json, {}).gallery_enriched) { meta.gallery_enriched = 1; images = [...new Set([...images, ...parseJson<string[]>(own.images_json, [])])]; }
    const f = [p.type, p.type_raw, p.title, p.description, images[0] ?? '', JSON.stringify(images.slice(0, 15)), p.price, p.currency, p.country, slugify(p.country), p.destination, p.place, p.nights, p.terms[0]?.from ?? p.date_from, p.date_to, p.meal, p.transport, p.affiliate_url, JSON.stringify(meta)];
    if (!own) {
      const base = slugify(`${p.title} ${p.country}`).slice(0, 180) || 'nabidka';
      let slug = base, n = 1;
      while (taken.has(slug)) { n++; slug = `${base.slice(0, 176)}-${n}`; }
      taken.add(slug);
      stmts.push(db.prepare(`INSERT INTO products (feed_id,partner_slug,external_id,content_hash,slug,type,type_raw,title,description,image_url,images_json,price,currency,country,country_slug,destination,place,nights,date_from,date_to,meal,transport,affiliate_url,meta_json,active,seen_run,last_seen,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`).bind(feed.id, feed.partner_slug, ext, hash, slug, ...f, run.runId, run.nowSql, run.nowSql, run.nowSql));
      upd.push(false);
    } else {
      stmts.push(db.prepare(`UPDATE products SET content_hash=?, type=?, type_raw=?, title=?, description=?, image_url=?, images_json=?, price=?, currency=?, country=?, country_slug=?, destination=?, place=?, nights=?, date_from=?, date_to=?, meal=?, transport=?, affiliate_url=?, meta_json=?, active=1, seen_run=?, last_seen=?, updated_at=? WHERE id=? AND seen_run <= ?`)
        .bind(hash, ...f, run.runId, run.nowSql, run.nowSql, own.id, run.runId));
      upd.push(true);
    }
  }
  const res = await runDetailed(db, stmts);
  res.forEach((r, i) => { if (!upd[i]) stats.created++; else if ((r.meta.changes ?? 0) > 0) stats.changed++; else stats.stale++; });
  return stats;
}
