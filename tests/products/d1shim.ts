import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

/** Minimal D1Database over node:sqlite with the real migrations applied (prepare/bind/all/first/run). */
export function makeD1(): { db: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  const dir = new URL('../../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(f, dir), 'utf8'));
  const stmt = (sql: string, params: unknown[] = []) => ({
    bind: (...p: unknown[]) => stmt(sql, p),
    async all() { return { results: raw.prepare(sql).all(...(params as any[])) as any[], success: true, meta: {} }; },
    async first() { return (raw.prepare(sql).get(...(params as any[])) as any) ?? null; },
    async run() { const r = raw.prepare(sql).run(...(params as any[])); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { db: { prepare: (s: string) => stmt(s) } as unknown as D1Database, raw };
}

export function seedProducts(raw: DatabaseSync): void {
  const now = '2026-10-26T10:00:00Z';
  raw.exec(`INSERT INTO partners (slug,name) VALUES ('invia','Invia'),('dovolena-cz','Dovolena.cz')`);
  raw.exec(`INSERT INTO feeds (id,name,partner_slug,adapter,content_type,source_ref) VALUES (1,'Invia','invia','xml-x','products','F1')`);
  const ins = raw.prepare(`INSERT INTO products (id,feed_id,partner_slug,external_id,content_hash,type,type_raw,slug,title,description,image_url,images_json,price,price_original,country,country_slug,destination,place,nights,date_from,date_to,affiliate_url,meta_json,active,hidden,last_seen,created_at,updated_at)
    VALUES (@id,1,@partner,@ext,'h',@type,@type_raw,@slug,@title,@description,@image,@images,@price,@orig,@country,@cslug,@dest,@place,@nights,@from,@to,'https://ehub.cz/click/x',@meta,@active,@hidden,'${now}','${now}','${now}')`);
  const base = { partner: 'invia', type_raw: '', description: 'Popis: POLOHA UBYTOVÁNÍ Hotel se nachází v centru města a nabízí snídani.', image: 'https://img.example/a.jpg', images: '["https://img.example/a.jpg","https://img.example/b.jpg"]', orig: null, country: 'Itálie', cslug: 'italie', dest: 'Řím', place: '', nights: 3, from: '2026-12-05', to: '2026-12-08', meta: '{"terms":[{"from":"2026-12-05","to":"2026-12-08","nights":3,"price":5990},{"from":"2025-01-01","to":"2025-01-04","nights":3,"price":4000}]}', active: 1, hidden: 0 };
  const rows = [
    { id: 1, ext: 'e1', type: 'eurovikendy', slug: 'eurovikend-rim', title: 'Eurovíkend ŘÍM | CK Invia', price: 5990 },
    { id: 2, ext: 'e2', type: 'eurovikendy', slug: 'eurovikend-pariz', title: 'Víkend v Paříži', price: 6990, country: 'Francie', cslug: 'francie', dest: 'Paříž' },
    { id: 3, ext: 'e3', type: 'eurovikendy', slug: 'skryty', title: 'Skrytý', price: 100, hidden: 1 },
    { id: 4, ext: 'e4', type: 'eurovikendy', slug: 'neaktivni', title: 'Neaktivní', price: 100, active: 0 },
    { id: 5, ext: 'e5', type: 'wellness', slug: 'wellness-lazne', title: 'Wellness pobyt v lázních', price: 3990, country: 'Česko', cslug: 'cesko', dest: 'Morava', place: 'Lednice', type_raw: 'Wellness víkend', description: '' },
    { id: 6, ext: 'e6', type: 'wellness', slug: 'wellness-kod', title: 'Kód 200', price: 2990, country: 'Česko', cslug: 'cesko', place: 'Praha', type_raw: '12345' },
  ];
  for (const r of rows) ins.run({ ...base, ...r } as any);
}
