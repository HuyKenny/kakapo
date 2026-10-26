/** Server-side validation for admin input (pure functions, unit-tested). */
import type { Sql } from './sql';

export const OVERRIDE_KINDS = ['landing', 'hotel', 'product', 'page'] as const;
export const OVERRIDE_FIELDS = ['h1', 'title', 'description', 'intro', 'seo_text', 'faqs_json', 'robots', 'canonical'] as const;
export type OverrideField = (typeof OVERRIDE_FIELDS)[number];
export const TITLE_MAX = 60; // same limit as the WordPress plugin (a longer title would be silently replaced there)

const MAX: Record<OverrideField, number> = { h1: 120, title: TITLE_MAX, description: 320, intro: 20_000, seo_text: 100_000, faqs_json: 40_000, robots: 20, canonical: 300 };
const RESERVED = /^\/(admin|api|go|akce|_astro|media)(\/|$)/;

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };
const bad = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** lower-case path, single leading slash, trailing slash; query/hash/host are rejected, not stripped. */
export function normalizePath(raw: string): Checked<string> {
  const s = raw.trim();
  if (!s.startsWith('/') || s.startsWith('//')) return bad('Cesta musí začínat jedním lomítkem.');
  if (/[?#\s\\]/.test(s)) return bad('Cesta nesmí obsahovat parametry, kotvu ani mezery.');
  if (/[\u0000-\u001f]/.test(s) || s.includes('..')) return bad('Neplatné znaky v cestě.');
  const p = s.toLowerCase();
  return { ok: true, value: p.endsWith('/') ? p : p + '/' };
}

export function validateOverride(kind: string, key: string, field: string, value: string): Checked<{ kind: string; key: string; field: OverrideField; value: string }> {
  if (!(OVERRIDE_KINDS as readonly string[]).includes(kind)) return bad('Neznámý typ.');
  if (!(OVERRIDE_FIELDS as readonly string[]).includes(field)) return bad('Neznámé pole.');
  const f = field as OverrideField;
  let k = key.trim();
  if (kind === 'landing' || kind === 'page') {
    const n = normalizePath(k);
    if (!n.ok) return n;
    if (RESERVED.test(n.value)) return bad('Tato cesta je vyhrazená.');
    k = n.value;
  } else if (!/^[a-z0-9][a-z0-9-]{0,190}$/.test(k)) return bad('Slug smí obsahovat malá písmena, číslice a pomlčky.');
  const v = value.replace(/\r\n/g, '\n').trim();
  if (!v) return bad('Hodnota je prázdná (použijte Smazat).');
  if (v.length > MAX[f]) return bad(`Pole ${f} má maximálně ${MAX[f]} znaků.`);
  if (f === 'title' && /[<>]/.test(v)) return bad('Title nesmí obsahovat HTML.');
  if ((f === 'h1' || f === 'description') && /[<>]/.test(v)) return bad('Pole nesmí obsahovat HTML.');
  if (f === 'robots' && !['index', 'noindex'].includes(v)) return bad('Robots: index nebo noindex.');
  if (f === 'canonical' && !/^(\/[^\s?#]*|https:\/\/(www\.)?kakapo\.cz\/[^\s?#]*)$/.test(v)) return bad('Canonical musí být cesta nebo URL na kakapo.cz.');
  if (f === 'faqs_json') {
    try {
      const a = JSON.parse(v) as unknown;
      if (!Array.isArray(a) || a.length > 30 || !a.every((x) => x && typeof x === 'object' && typeof (x as Record<string, unknown>).q === 'string' && typeof (x as Record<string, unknown>).a === 'string' && (x as { q: string }).q.trim() && (x as { a: string }).a.trim())) {
        return bad('FAQ musí být JSON pole objektů {"q": "...", "a": "..."} (max. 30).');
      }
    } catch {
      return bad('FAQ není platný JSON.');
    }
  }
  if ((f === 'intro' || f === 'seo_text') && /<\s*(script|iframe|object|embed|style)\b|\son\w+\s*=|javascript:/i.test(v)) return bad('HTML obsahuje nepovolený prvek.');
  return { ok: true, value: { kind, key: k, field: f, value: v } };
}

export const REDIRECT_STATUSES = [301, 302, 308, 410] as const;

/** Rejects loops, chains (to-target is itself a source, or source is already a target) and reserved paths. */
export async function validateRedirect(db: Sql, fromRaw: string, toRaw: string, statusRaw: number): Promise<Checked<{ from: string; to: string; status: number }>> {
  const status = Number(statusRaw);
  if (!(REDIRECT_STATUSES as readonly number[]).includes(status)) return bad('Status musí být 301, 302, 308 nebo 410.');
  const from = normalizePath(fromRaw);
  if (!from.ok) return from;
  if (RESERVED.test(from.value) || from.value === '/') return bad('Tuto cestu nelze přesměrovat.');
  if (status === 410) return { ok: true, value: { from: from.value, to: '', status } };
  const to = normalizePath(toRaw);
  if (!to.ok) return bad('Cíl: ' + to.error);
  if (RESERVED.test(to.value)) return bad('Cíl nesmí být vyhrazená cesta.');
  if (to.value === from.value) return bad('Cíl je stejný jako zdroj (smyčka).');
  const targetIsSource = await db.first<{ to_path: string }>('SELECT to_path FROM redirects WHERE from_path = ?', [to.value]);
  if (targetIsSource) return bad('Cíl sám přesměrovává jinam (řetězec). Použijte konečný cíl.');
  const sourceIsTarget = await db.first<{ from_path: string }>('SELECT from_path FROM redirects WHERE to_path = ? AND from_path != ? LIMIT 1', [from.value, from.value]);
  if (sourceIsTarget) return bad(`Zdroj je cílem přesměrování z ${sourceIsTarget.from_path} (vznikl by řetězec). Upravte nejdřív to.`);
  return { ok: true, value: { from: from.value, to: to.value, status } };
}
