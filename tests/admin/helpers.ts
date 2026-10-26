import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type { Param, Sql } from '../../src/lib/admin/sql';

/** In-memory SQLite with the real migrations applied (same dialect as D1). */
export function makeDb(): { sql: Sql; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  for (const f of ['0001_init.sql', '0003_offer_blocklist.sql']) raw.exec(readFileSync(new URL(`../../migrations/${f}`, import.meta.url), 'utf8'));
  const sql: Sql = {
    async all<T>(q: string, p: Param[] = []) { return raw.prepare(q).all(...p) as T[]; },
    async first<T>(q: string, p: Param[] = []) { return (raw.prepare(q).get(...p) as T | undefined) ?? null; },
    async run(q: string, p: Param[] = []) { const r = raw.prepare(q).run(...p); return { changes: Number(r.changes) }; },
    async batch(stmts) { raw.exec('BEGIN'); try { for (const s of stmts) raw.prepare(s.sql).run(...(s.params ?? [])); raw.exec('COMMIT'); } catch (e) { raw.exec('ROLLBACK'); throw e; } },
  };
  return { sql, raw };
}

export function seed(raw: DatabaseSync): void {
  const now = '2026-10-26T10:00:00Z';
  raw.exec(`INSERT INTO partners (slug,name) VALUES ('fischer','Fischer'),('invia','Invia')`);
  raw.exec(`INSERT INTO feeds (id,name,partner_slug,adapter,content_type,source_ref,enabled) VALUES (1,'Fischer','fischer','cj-atcom','hotels','FEED_URL_1',1),(2,'Invia','invia','xml-invia_hotels','hotels','FEED_URL_2',0)`);
  raw.exec(`INSERT INTO hotels (id,slug,dedup_key,name,created_at,updated_at) VALUES (1,'lino-mare','a|b|c','Lino Mare','${now}','${now}'),(2,'hidden-hotel','a|b|d','Hidden','${now}','${now}')`);
  raw.exec(`UPDATE hotels SET hidden=1 WHERE id=2`);
  const url = 'https://www.kqzyfj.com/click-101626353-15082725?url=https%3A%2F%2Fwww.fischer.cz%2Frecko%3FDF%3D2026-10-16%257C2026-11-13%26PID%3DHER90098&cjsku=146443';
  const ins = (id: number, hotel: number, ext: string, aff: string, active: number) =>
    raw.prepare(`INSERT INTO offers (id,hotel_id,feed_id,partner_slug,external_id,content_hash,price_pp,departure_date,affiliate_url,active,last_seen,created_at,updated_at) VALUES (?,?,1,'fischer',?,'h',20000,'2026-12-01',?,?,?,?,?)`).run(id, hotel, ext, aff, active, now, now, now);
  ins(10, 1, 'e10', url, 1);
  ins(11, 1, 'e11', url, 0);
  ins(12, 2, 'e12', url, 1);
  ins(13, 1, 'e13', 'http://evil.example/steal', 1);
  ins(14, 1, 'e14', 'https://kqzyfj.com.evil.example/x', 1);
  raw.prepare(`INSERT INTO products (id,feed_id,partner_slug,external_id,content_hash,slug,title,price,affiliate_url,last_seen,created_at,updated_at) VALUES (5,1,'invia','p5','h','zajezd-5','Zájezd',9990,'https://ehub.cz/click/abc?x=1&y=%2F',?,?,?)`).run(now, now, now);
}
export const CJ_URL = 'https://www.kqzyfj.com/click-101626353-15082725?url=https%3A%2F%2Fwww.fischer.cz%2Frecko%3FDF%3D2026-10-16%257C2026-11-13%26PID%3DHER90098&cjsku=146443';
