// Declarative XML -> normalised data mapper (port of Kakapo_Xml_Mapper). The mapping JSON (path + whitelisted
// transforms) comes from the feeds table; nothing is eval'ed.
import type { XmlNode } from './stream';
import { md5 } from '../util/md5';
import { normalizeMeal, normalizeTransport, slugify, stripTags, isYmd, removeAccents } from '../util/text';

export interface FieldDef { path?: string; paths?: string[]; multiple?: boolean; aggregate?: string; transforms?: Array<string | Record<string, unknown>>; default?: unknown }
export interface Mapping {
  mode?: 'flat' | 'nested' | 'product';
  item: string;
  offer_item?: string;
  default_type?: string;
  force_type?: string;
  product_filter?: { field: string; contains_any: string[] };
  fields: Record<string, FieldDef>;
  terms?: { item: string; fields: Record<string, FieldDef | string> };
}


import { ISO3 } from '../util/country';

export interface MapCtx { today: string }

// ---- tree access ---------------------------------------------------------------------------------------------
const kids = (n: XmlNode, name: string) => n.children.filter((c) => c.name === name);
function descendants(n: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of n.children) { if (c.name === name) out.push(c); descendants(c, name, out); }
  return out;
}
export function findNodes(node: XmlNode, path: string): XmlNode[] {
  let nodes = [node];
  for (const part of path.split('/')) {
    if (part === '') continue;
    nodes = nodes.flatMap((n) => kids(n, part));
  }
  return nodes;
}
function resolveAll(node: XmlNode, path: string): string[] {
  if (path === '.') return [node.text.trim()];
  if (path.startsWith('//')) return descendants(node, path.slice(2)).map((n) => n.text.trim());
  let nodes = [node];
  for (const part of path.split('/')) {
    if (part === '') continue;
    if (part.startsWith('@')) {
      const a = part.slice(1);
      return nodes.map((n) => n.attrs[a] ?? '').filter((v) => v !== '');
    }
    nodes = nodes.flatMap((n) => kids(n, part));
    if (!nodes.length) return [];
  }
  return nodes.map((n) => n.text.trim());
}

// ---- transforms ---------------------------------------------------------------------------------------------
const num = (v: unknown) => Number(String(v ?? '').replace(/[\s ]/g, '').replace(',', '.')) || 0;
const phpInt = (v: unknown) => Math.round(num(v));

/** strtotime-ish: ISO, ISO datetime, d.m.Y with optional spaces; null when unusable. */
export function toYmd(v: unknown): string | null {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) { const r = `${m[1]}-${m[2]}-${m[3]}`; return isYmd(r) ? r : null; }
  m = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/.exec(s);
  if (m) { const r = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`; return isYmd(r) ? r : null; }
  return null;
}
/** Subset of PHP DateTime::createFromFormat: d j m n Y y plus literal separators. */
export function parseWithFormat(format: string, value: string): string | null {
  let re = '';
  const order: string[] = [];
  for (const ch of format) {
    if (ch === 'd' || ch === 'm') { re += '(\\d{2})'; order.push(ch); }
    else if (ch === 'j' || ch === 'n') { re += '(\\d{1,2})'; order.push(ch); }
    else if (ch === 'Y') { re += '(\\d{4})'; order.push(ch); }
    else if (ch === 'y') { re += '(\\d{2})'; order.push(ch); }
    else if ('HisGgh'.includes(ch)) { re += '\\d{1,2}'; }
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  const m = new RegExp('^' + re).exec(value.trim());
  if (!m) return null;
  let y = 0, mo = 0, d = 0;
  order.forEach((k, i) => {
    const n = Number(m[i + 1]);
    if (k === 'Y') y = n; else if (k === 'y') y = 2000 + n; else if (k === 'm' || k === 'n') mo = n; else d = n;
  });
  const r = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isYmd(r) ? r : null;
}

function gpsPart(v: unknown, i: number): number {
  const parts = String(v ?? '').trim().split(/\s*,\s*/);
  return parts[i] ? Number(parts[i]!.replace(',', '.')) || 0 : 0;
}

type V = unknown;
function simple(v: V, name: string): V {
  switch (name) {
    case 'trim': return String(v ?? '').trim();
    case 'int': return phpInt(v);
    case 'nights_from_days': return Math.max(1, phpInt(v) - 1);
    case 'float': return num(v);
    case 'gps_lat': return gpsPart(v, 0);
    case 'gps_lng': return gpsPart(v, 1);
    case 'strip_tags': return stripTags(String(v ?? '').replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')).trim();
    case 'meal': return normalizeMeal(v);
    case 'transport': return normalizeTransport(v);
    case 'slug': return slugify(v);
    case 'upper': return String(v ?? '').toUpperCase();
    case 'lower': return String(v ?? '').toLowerCase();
    case 'ymd': return toYmd(v);
    case 'iso3_country': return ISO3[String(v ?? '').trim().toUpperCase()] ?? '';
    case 'hash': { const s = String(v ?? '').trim(); return s === '' ? '' : md5(s).slice(0, 24); }
    case 'img_url': { const u = String(v ?? '').trim(); return /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(u) ? u : ''; }
    case 'excursia_img': {
      const u = String(v ?? '').trim();
      const m = /^(https?:\/\/[^/]*excursia\.cz)\/([^/]+\.(?:jpe?g|png|webp))$/i.exec(u);
      return m ? `${m[1]}/fotky/velky/${m[2]}` : u;
    }
    case 'stars_from_title': { const m = /(\d)\s*\*/.exec(String(v ?? '')); return m ? Number(m[1]) : 0; }
    case 'stars_decimal': return Math.floor(num(String(v ?? '').trim()));
    default: return v;
  }
}
function withArg(v: V, name: string, arg: unknown): V {
  switch (name) {
    case 'date': return parseWithFormat(String(arg), String(v ?? ''));
    case 'map': {
      const key = String(v ?? '').trim();
      if (arg && typeof arg === 'object') {
        const a = arg as Record<string, unknown>;
        if (key in a) return a[key];
        for (const k of Object.keys(a)) if (k.toLowerCase() === key.toLowerCase()) return a[k];
      }
      return v;
    }
    case 'concat_base': {
      const s = String(v ?? '').trim();
      if (s === '') return '';
      return s.startsWith('http') ? s : String(arg).replace(/\/+$/, '') + '/' + s.replace(/^\/+/, '');
    }
    case 'default': return v === null || v === undefined || v === '' ? arg : v;
    case 'multiply': return num(v) * num(arg);
    case 'subtract': return phpInt(v) - phpInt(arg);
    default: return v;
  }
}
function applyTransforms(v: V, ts: Array<string | Record<string, unknown>>): V {
  for (const t of ts) {
    if (typeof t === 'string') v = simple(v, t);
    else for (const [k, a] of Object.entries(t)) v = withArg(v, k, a);
  }
  return v;
}

function aggregate(vals: V[], mode: string, ctx: MapCtx): V {
  if (!vals.length) return null;
  switch (mode) {
    case 'min': return Math.min(...vals.map((x) => Number(x)));
    case 'max': return Math.max(...vals.map((x) => Number(x)));
    case 'first': return vals[0];
    case 'min_future': {
      const dates = vals.filter((d) => isYmd(d)).sort() as string[];
      return dates.find((d) => d >= ctx.today) ?? dates[dates.length - 1] ?? null;
    }
    default: return vals;
  }
}

function extract(node: XmlNode, def: FieldDef, ctx: MapCtx): V {
  const paths = (def.paths ?? [def.path ?? '']).filter((p) => p !== '');
  if (!paths.length) return def.default ?? null;
  const ts = def.transforms ?? [];
  if (def.multiple) {
    const seen = new Set<unknown>();
    const vals: V[] = [];
    for (const p of paths) for (const raw of resolveAll(node, p)) {
      const v = applyTransforms(raw, ts);
      if (v !== null && v !== '' && !seen.has(v)) { seen.add(v); vals.push(v); }
    }
    return def.aggregate ? aggregate(vals, def.aggregate, ctx) : vals;
  }
  for (const p of paths) {
    const raw = resolveAll(node, p)[0];
    if (raw !== undefined && raw !== '') return applyTransforms(raw, ts);
  }
  return def.default ?? null;
}

export interface RawHotelItem { hotel: Record<string, V>; offers: Array<Record<string, V>> }
export interface RawProductItem { product: Record<string, V> }

export function mapItem(item: XmlNode, m: Mapping, ctx: MapCtx): RawHotelItem | RawProductItem {
  const fields = m.fields;
  if (m.mode === 'product') {
    const product: Record<string, V> = {};
    for (const [target, def] of Object.entries(fields)) if (target.startsWith('product.')) product[target.slice(8)] = extract(item, def, ctx);
    if (m.terms) {
      product.terms = findDescendantsByName(item, m.terms.item).map((n) => {
        const row: Record<string, V> = {};
        for (const [k, d] of Object.entries(m.terms!.fields)) row[k] = extract(n, typeof d === 'string' ? { path: d } : d, ctx);
        return row;
      });
    }
    return { product };
  }
  const hotel: Record<string, V> = {};
  const offerDefs: Record<string, FieldDef> = {};
  for (const [target, def] of Object.entries(fields)) {
    if (target.startsWith('hotel.')) hotel[target.slice(6)] = extract(item, def, ctx);
    else if (target.startsWith('offer.')) offerDefs[target.slice(6)] = def;
  }
  const mapOffer = (node: XmlNode, parent: XmlNode | null) => {
    const o: Record<string, V> = {};
    for (const [k, def] of Object.entries(offerDefs)) {
      let v = extract(node, def, ctx);
      if ((v === null || v === '') && parent) v = extract(parent, def, ctx);
      o[k] = v;
    }
    return o;
  };
  const offers = m.mode === 'nested' && m.offer_item ? findNodes(item, m.offer_item).map((n) => mapOffer(n, item)) : [mapOffer(item, null)];
  return { hotel, offers };
}
const findDescendantsByName = (n: XmlNode, name: string) => descendants(n, name);

export function productIncluded(product: Record<string, V>, m: Mapping): boolean {
  const f = m.product_filter;
  if (!f || !f.field || !f.contains_any?.length) return true;
  const raw = product[f.field];
  const values = (Array.isArray(raw) ? raw : [raw]).map((x) => String(x ?? ''));
  return values.some((val) => f.contains_any.some((needle) => val.toLowerCase().includes(String(needle).toLowerCase())));
}

export { removeAccents };
