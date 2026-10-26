// Converts the WordPress NDJSON export into D1 SQL chunks (migration 0001 schema).
// Usage: tsx scripts/migrate-from-wp.ts <export-dir> <out-sql-dir> [--report <file>]
// Only ACTIVE offers are carried over; everything is reported (rejected rows are counted by reason).
import { createReadStream, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { computeThemeFlags } from '../src/lib/themes';

const dir = process.argv[2] as string, out = process.argv[3] as string;
if (!dir || !out) throw new Error('usage: migrate-from-wp.ts <export-dir> <out-sql-dir>');
mkdirSync(out, { recursive: true });

const q = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
};
const int = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Math.trunc(Number(v)));
const intz = (v: unknown, d = 0): number => int(v) ?? d;
const nz = (v: unknown): number | null => { const n = int(v); return n ? n : null; };
const flt = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const iso = (v: unknown): string | null => (v ? String(v) : null);

const ADAPTER: Record<string, string> = { fischer: 'cj-atcom', 'exim-tours': 'cj-atcom', 'blue-style': 'cj-bluestyle', tui: 'cj-tui', cedok: 'cedok-slim' };
const hash = (parts: unknown[]) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);

class Chunker {
  private buf: string[] = []; private size = 0; private n = 0;
  constructor(private prefix: string) {}
  push(sql: string) { this.buf.push(sql); this.size += sql.length; if (this.size > 4_000_000) this.flush(); }
  flush() { if (!this.buf.length) return; writeFileSync(join(out, `${this.prefix}-${String(this.n++).padStart(3, '0')}.sql`), this.buf.join('\n') + '\n'); this.buf = []; this.size = 0; }
}
async function* rows(name: string): AsyncGenerator<any> {
  const f = join(dir, `${name}.ndjson`);
  if (!existsSync(f)) return;
  for await (const line of createInterface({ input: createReadStream(f), crlfDelay: Infinity })) if (line) yield JSON.parse(line);
}
const report: Record<string, any> = { rejected: {} as Record<string, number>, counts: {} as Record<string, number> };
const reject = (why: string) => { report.rejected[why] = (report.rejected[why] ?? 0) + 1; };

// partners + feeds (feed URLs are NOT in the export; they are Worker secrets FEED_URL_<id>)
const feedsSql = new Chunker('01-feeds');
const partners = new Map<string, string>();
const feedMeta = new Map<number, { partner: string; ctype: string }>();
for await (const f of rows('feeds')) {
  const adapter = ADAPTER[f.partner_slug] ?? (f.source_type === 'cj' ? 'cj-generic' : `xml-${f.format_preset}`);
  partners.set(f.partner_slug, f.partner_slug);
  feedMeta.set(Number(f.id), { partner: f.partner_slug, ctype: f.content_type });
  feedsSql.push(`INSERT INTO feeds (id,name,partner_slug,adapter,content_type,is_full_catalogue,source_ref,interval_hours,enabled,next_run_at) VALUES (${f.id},${q(f.name)},${q(f.partner_slug)},${q(adapter)},${q(f.content_type)},1,${q('FEED_URL_' + f.id)},${intz(f.interval_hours, 6)},${intz(f.enabled, 1)},NULL);`);
}
const pSql = new Chunker('00-partners');
for (const p of partners.keys()) pSql.push(`INSERT INTO partners (slug,name,disclosure,enabled) VALUES (${q(p)},${q(p)},'',1);`);
pSql.flush(); feedsSql.flush();

// offer texts per hotel (active offers) feed the keyword themes
const offerTexts = new Map<number, string[]>();
for await (const o of rows('offers')) {
  if (String(o.active) !== '1') continue;
  const arr = offerTexts.get(Number(o.hotel_id)) ?? [];
  if (arr.length < 40) { arr.push(o.title ?? '', o.room_type ?? ''); offerTexts.set(Number(o.hotel_id), arr); }
}
// hotels (all rows keep their URL; hidden=0)
const hSql = new Chunker('02-hotels'); const hotelIds = new Set<number>(); let hn = 0;
for await (const h of rows('hotels')) {
  hotelIds.add(Number(h.id)); hn++;
  hSql.push(`INSERT INTO hotels (id,slug,dedup_key,giata_id,name,country,country_slug,destination,destination_slug,city,city_slug,stars,rating,rating_count,lat,lng,description,description_source,images_json,images_source,amenities_json,min_price,prev_min_price,price_drop_pct,offers_active,offers_last_seen,partners_count,has_last_minute,has_first_minute,has_all_inclusive,meal_flags,airports_csv,theme_flags,created_at,updated_at) VALUES (${h.id},${q(h.slug)},${q(h.dedup_key)},${q(int(h.giata_id))},${q(h.name)},${q(h.country)},${q(h.country_slug)},${q(h.destination)},${q(h.destination_slug)},${q(h.city)},${q(h.city_slug)},${intz(h.stars)},${q(flt(h.rating))},${intz(h.rating_count)},${q(flt(h.lat))},${q(flt(h.lng))},${q(h.description)},${q(h.description_source ?? '')},${q(h.images)},${q(h.images_source ?? '')},${q(h.amenities)},${q(int(h.min_price))},${q(int(h.prev_min_price))},${intz(h.price_drop_pct)},${intz(h.offers_active)},${q(iso(h.offers_last_seen))},${intz(h.partners_count)},${intz(h.has_last_minute)},${intz(h.has_first_minute)},${intz(h.has_all_inclusive)},${intz(h.meal_flags)},${q(h.airports_csv ?? '')},${computeThemeFlags({ name: h.name, description: h.description, amenities: h.amenities, offerTexts: offerTexts.get(Number(h.id)) ?? [] })},${q(h.created_at)},${q(h.updated_at)});`);
}
hSql.flush(); report.counts.hotels = hn;

const aSql = new Chunker('03-aliases'); let an = 0;
for await (const a of rows('hotel_aliases')) {
  if (!hotelIds.has(Number(a.hotel_id))) { reject('alias: hotel missing'); continue; }
  an++; aSql.push(`INSERT INTO hotel_aliases (alias_key,hotel_id,created_at) VALUES (${q(a.alias_key)},${a.hotel_id},${q(a.created_at)});`);
}
aSql.flush(); report.counts.hotel_aliases = an;

// offers: active only, validated
const oSql = new Chunker('04-offers'); const perPartner: Record<string, number> = {}; let on = 0;
for await (const o of rows('offers')) {
  if (String(o.active) !== '1') continue;
  if (!hotelIds.has(Number(o.hotel_id))) { reject('offer: hotel missing'); continue; }
  if (!feedMeta.has(Number(o.feed_id))) { reject('offer: feed missing'); continue; }
  if (!(Number(o.price_pp) > 0)) { reject('offer: price<=0'); continue; }
  if (!/^https?:\/\//.test(o.affiliate_url ?? '')) { reject('offer: bad affiliate_url'); continue; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.departure_date ?? '')) { reject('offer: bad departure'); continue; }
  const h = hash([o.price_pp, o.price_total, o.price_original, o.departure_date, o.return_date, o.nights, o.meal_type, o.transport, o.airport_slug, o.room_type, o.adults, o.children, o.availability, o.affiliate_url]);
  perPartner[o.partner_slug] = (perPartner[o.partner_slug] ?? 0) + 1; on++;
  oSql.push(`INSERT INTO offers (id,hotel_id,feed_id,partner_slug,external_id,content_hash,title,price_pp,price_total,price_original,prev_price_pp,price_changed_at,currency,departure_date,return_date,nights,days,meal_type,transport,airport,airport_slug,arrival_airport,room_type,adults,children,availability,is_last_minute,is_first_minute,affiliate_url,image_url,active,last_seen,created_at,updated_at) VALUES (${o.id},${o.hotel_id},${o.feed_id},${q(o.partner_slug)},${q(o.external_id)},${q(h)},${q(o.title ?? '')},${intz(o.price_pp)},${q(nz(o.price_total))},${q(nz(o.price_original))},${q(nz(o.prev_price_pp))},${q(iso(o.price_changed_at))},${q(o.currency || 'CZK')},${q(o.departure_date)},${q(iso(o.return_date))},${intz(o.nights, 7)},${intz(o.days, 8)},${q(o.meal_type)},${q(o.transport)},${q(o.airport ?? '')},${q(o.airport_slug ?? '')},${q(o.arrival_airport ?? '')},${q(o.room_type ?? '')},${intz(o.adults, 2)},${intz(o.children)},${q(o.availability)},${intz(o.is_last_minute)},${intz(o.is_first_minute)},${q(o.affiliate_url)},${q(o.image_url)},1,${q(o.last_seen)},${q(o.created_at)},${q(o.updated_at)});`);
}
oSql.flush(); report.counts.offers_active = on; report.counts.offers_by_partner = perPartner;

const pdSql = new Chunker('05-products'); let pn = 0; const slugs = new Set<string>();
for await (const p of rows('products')) {
  if (!feedMeta.has(Number(p.feed_id)) || slugs.has(p.slug) || !(Number(p.price) > 0) || !/^https?:\/\//.test(p.affiliate_url ?? '')) { reject('product: invalid/duplicate'); continue; }
  slugs.add(p.slug); pn++;
  const h = hash([p.price, p.price_original, p.date_from, p.date_to, p.title, p.affiliate_url]);
  pdSql.push(`INSERT INTO products (id,feed_id,partner_slug,external_id,content_hash,type,type_raw,slug,title,description,image_url,images_json,price,price_original,currency,country,country_slug,destination,place,nights,date_from,date_to,meal,transport,affiliate_url,meta_json,active,last_seen,created_at,updated_at) VALUES (${p.id},${p.feed_id},${q(p.partner_slug)},${q(p.external_id)},${q(h)},${q(p.type)},${q(p.type_raw ?? '')},${q(p.slug)},${q(p.title)},${q(p.description)},${q(p.image_url)},${q(p.images)},${intz(p.price)},${q(nz(p.price_original))},${q(p.currency || 'CZK')},${q(p.country ?? '')},${q(p.country_slug ?? '')},${q(p.destination ?? '')},${q(p.place ?? '')},${q(int(p.nights))},${q(iso(p.date_from))},${q(iso(p.date_to))},${q(p.meal ?? '')},${q(p.transport ?? '')},${q(p.affiliate_url)},${q(p.meta)},${intz(p.active, 1)},${q(p.last_seen)},${q(p.created_at)},${q(p.updated_at)});`);
}
pdSql.flush(); report.counts.products = pn;

const phSql = new Chunker('06-price-history'); let phn = 0;
const cutoff = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
for await (const r of rows('price_history')) {
  if (!hotelIds.has(Number(r.hotel_id)) || r.snap_date < cutoff) continue;
  phn++; phSql.push(`INSERT OR IGNORE INTO price_history (hotel_id,snap_date,min_price) VALUES (${r.hotel_id},${q(r.snap_date)},${intz(r.min_price)});`);
}
phSql.flush(); report.counts.price_history = phn;

// editorial landing texts (separate export, see export-landing-texts below)
const lt = join(dir, 'landing_texts.json');
if (existsSync(lt)) {
  const eSql = new Chunker('07-editorial'); const now = new Date().toISOString(); let en = 0;
  for (const [path, f] of Object.entries<any>(JSON.parse(readFileSync(lt, 'utf8')))) {
    for (const [field, val] of Object.entries<any>(f)) {
      if (val === null || val === '' || (Array.isArray(val) && !val.length)) continue;
      en++; eSql.push(`INSERT INTO editorial_overrides (kind,key,field,value,updated_at) VALUES ('landing',${q(path)},${q(field === 'faqs' ? 'faqs_json' : field)},${q(typeof val === 'string' ? val : JSON.stringify(val))},${q(now)});`);
    }
  }
  eSql.flush(); report.counts.editorial_overrides = en;
}
// merged hotels: old slug -> winner slug (301 from /hotel/{old}/)
const hr = join(dir, 'hotel_redirects.json');
if (existsSync(hr)) {
  const rSql = new Chunker('08-redirects'); let rn = 0; const nowIso = new Date().toISOString();
  for (const [from, to] of Object.entries<string>(JSON.parse(readFileSync(hr, 'utf8')))) {
    if (!from || !to || from === to) { reject('redirect: invalid'); continue; }
    rn++; rSql.push(`INSERT OR REPLACE INTO redirects (from_path,to_path,status,reason,created_at) VALUES (${q('/hotel/' + from + '/')},${q('/hotel/' + to + '/')},301,'merge',${q(nowIso)});`);
  }
  rSql.flush(); report.counts.redirects = rn;
}
writeFileSync(join(out, '_report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
