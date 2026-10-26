// Oracle: compare loadHotel() over a local SQLite built from the WP export with the live WordPress pages.
// Usage: tsx tests/hotel/oracle.ts <sql-dir> [slug ...]   (builds /tmp/kk-oracle.db once; needs network, UA with unique suffix)
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadHotel } from '../../src/lib/hotel';

const dir = process.argv[2] as string; const slugsArg = process.argv.slice(3);
const dbFile = '/tmp/kk-oracle.db';
const fresh = !existsSync(dbFile);
const raw = new DatabaseSync(dbFile);
if (fresh) {
  raw.exec(readFileSync(new URL('../../migrations/0001_init.sql', import.meta.url), 'utf8'));
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(`${dir}/${f}`, 'utf8'));
}
const prep = (sql: string, params: unknown[] = []): any => ({
  bind: (...p: unknown[]) => prep(sql, p),
  all: async () => ({ results: raw.prepare(sql).all(...(params as any[])) }),
  first: async () => raw.prepare(sql).get(...(params as any[])) ?? null,
});
const db = { prepare: (s: string) => prep(s) } as unknown as D1Database;

let slugs = slugsArg;
if (!slugs.length) {
  const q = (s: string) => (raw.prepare(s).all() as any[]).map((r) => r.slug as string);
  slugs = [
    ...q("SELECT slug FROM hotels WHERE offers_active >= 8 AND partners_count >= 3 AND length(description) > 400 ORDER BY id LIMIT 2"),
    ...q("SELECT slug FROM hotels WHERE offers_active = 1 AND length(description) < 200 AND images_json NOT IN ('[]','') ORDER BY id LIMIT 1"),
    ...q("SELECT slug FROM hotels WHERE offers_active = 0 AND offers_last_seen > date('now','-120 day') AND length(description) > 300 ORDER BY id LIMIT 1"),
    ...q("SELECT slug FROM hotels WHERE offers_active BETWEEN 2 AND 4 AND rating >= 8 AND rating_count >= 3 ORDER BY id LIMIT 1"),
  ];
}
const dec = (s: string) => s.replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#8211;/g, '–').replace(/&#8212;/g, '—');
const strip = (s: string) => dec(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const FOOTER = new Set(['Oblíbené destinace', 'Objevte', 'Populární výběry', 'Partnerské cestovní kanceláře']);
const rows: string[] = [];
for (const slug of slugs) {
  const url = `https://kakapo.cz/hotel/${slug}/`;
  let html = '';
  try { html = execFileSync('curl', ['-s', '-m', '60', '-A', `Mozilla/5.0 (X11; Linux aarch64) KakapoSeoSnapshot/1.0 o${Date.now()}`, url], { maxBuffer: 20_000_000 }).toString('utf8'); } catch (e) { rows.push(`${slug}: FETCH FAILED`); continue; }
  const live = {
    title: strip(/<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? ''),
    desc: dec(/<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? ''),
    robots: (/<meta name="robots" content="([^"]*)"/.exec(html)?.[1] ?? /name='robots' content='([^']*)'/.exec(html)?.[1] ?? '').split(',').map((x) => x.trim()).filter((x) => x === 'index' || x === 'noindex' || x === 'follow' || x === 'nofollow'),
    canonical: /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? '',
    h1: strip(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? ''),
    offers: (html.split('<tbody x-show="!loaded">')[1]?.split('</tbody>')[0]?.match(/<tr>/g) ?? []).length,
    h2: [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => strip(m[1]!)).filter((t) => !FOOTER.has(t)),
    faq: [...html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((m) => strip(m[1]!)),
  };
  if (!live.title) { rows.push(`${slug}: live page has no <title> (status/redirect?)  ${html.length} bytes`); continue; }
  const r = await loadHotel(db, slug, { siteUrl: 'https://kakapo.cz' });
  if (!r || r.kind !== 'ok') { rows.push(`${slug}: loadHotel -> ${JSON.stringify(r)}`); continue; }
  const v = r.view;
  const mine = {
    title: v.meta.title, desc: v.meta.description, robots: v.meta.robots, canonical: v.meta.canonical, h1: v.hotel.name, offers: v.offers.length,
    h2: [
      ...(v.descriptionParas.length ? ['O hotelu'] : []), ...(v.fitPoints.length ? ['Pro koho se hotel hodí'] : []), ...(v.relatedLinks.length ? ['Související výběr'] : []),
      ...(v.checkPoints.length ? ['V čem se nabídky liší'] : []), ...(v.amenities.length ? ['Vybavení hotelu'] : []), ...(v.hotel.lat !== null && v.hotel.lng !== null ? ['Poloha'] : []),
      ...(v.rating !== null ? ['Recenze'] : []), 'Nabídky cestovních kanceláří', ...(v.faqs.length ? ['Nejčastější otázky k hotelu'] : []),
      ...(v.similar.length ? ['Podobné zájezdy'] : []), ...(v.nearby.length >= 3 && v.nearbyLabel ? [`Další hotely — ${v.nearbyLabel}`] : []),
    ],
    faq: v.faqs.map((f) => f.q),
  };
  const diffs: string[] = [];
  for (const k of ['title', 'desc', 'canonical', 'h1', 'offers'] as const) if (String((live as any)[k]) !== String((mine as any)[k])) diffs.push(`  ${k}:\n    live: ${(live as any)[k]}\n    mine: ${(mine as any)[k]}`);
  if (live.robots.join(',') !== mine.robots.join(',')) diffs.push(`  robots: live ${live.robots.join(',')} / mine ${mine.robots.join(',')}`);
  if (live.h2.join('|') !== mine.h2.join('|')) diffs.push(`  h2:\n    live: ${live.h2.join(' | ')}\n    mine: ${mine.h2.join(' | ')}`);
  if (live.faq.join('|') !== mine.faq.join('|')) diffs.push(`  faq:\n    live: ${live.faq.join(' | ')}\n    mine: ${mine.faq.join(' | ')}`);
  rows.push(`${slug}: ${diffs.length ? 'RŮZNÉ' : 'SHODA'} (offers live ${live.offers} / mine ${mine.offers})${diffs.length ? '\n' + diffs.join('\n') : ''}`);
}
console.log(rows.join('\n\n'));
