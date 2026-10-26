// Compares landing logic output (over the exported catalogue) with the live WordPress pages.
// Usage: tsx tests/landing/tools/oracle.ts [path ...]   (writes a markdown report to stdout)
import { execFileSync } from 'node:child_process';
import { exportDb } from '../d1';
import { resolveRoute, landingContext, landingTitle, landingDescription, getTopic, canonicalAliasTarget } from '../../../src/lib/landing';
import { search, normalizeFilters } from '../../../src/lib/search';

const PATHS = process.argv.slice(2).length ? process.argv.slice(2) : ['/recko/', '/recko/kos/', '/last-minute/', '/all-inclusive/', '/dovolena-u-more/', '/odlet-z-prahy/', '/egypt/hurghada/', '/cedok-zajezdy/', '/zajezdy/', '/kam-v-rijnu-k-mori/', '/egypt/dovolena-listopad/'];
const e = exportDb(); if (!e) throw new Error('export missing');
const UA = 'Mozilla/5.0 (X11; Linux aarch64) KakapoSeoSnapshot/1.0';
const strip = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#0?39;|&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const h2s = (html: string) => [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => strip(m[1]!));
const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date());

console.log('| URL | pole | živě | nově | shoda |\n|---|---|---|---|---|');
for (const p of PATHS) {
  const out = execFileSync('curl', ['-s', '-m', '60', '-A', UA, '-w', '\n%{http_code}', 'https://kakapo.cz' + p], { maxBuffer: 50e6 }).toString();
  const html = out.slice(0, out.lastIndexOf('\n')); const res = { status: Number(out.slice(out.lastIndexOf('\n') + 1)) };
  const liveTitle = strip(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  const liveDesc = /<meta name="description" content="([^"]*)"/i.exec(html)?.[1] ?? '';
  const liveH1 = strip(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '');
  const liveH2 = h2s(html);
  const liveRobots = /<meta name="robots" content="([^"]*)"/i.exec(html)?.[1] ?? '';
  const row = (f: string, a: string, b: string) => console.log(`| ${p} | ${f} | ${a.replace(/\|/g, '/')} | ${b.replace(/\|/g, '/')} | ${a === b ? 'ano' : 'NE'} |`);
  if (res.status !== 200) { console.log(`| ${p} | HTTP | ${res.status} | - | - |`); continue; }
  const route = await resolveRoute(e.db, p);
  if (!route) { row('route', 'ok', 'null'); continue; }
  const ctx = await landingContext(e.db, route.page, route.vars);
  if (!ctx) { row('ctx', 'ok', 'null'); continue; }
  const result = await search(e.db, normalizeFilters(ctx.filters), todayStr);
  const probe = await search(e.db, normalizeFilters({ ...ctx.filters, sort: 'price', page: 1 }), todayStr);
  const isCk = !!ctx.topic?.partner_page;
  const desc = isCk ? ctx.description : landingDescription(ctx, result.total, { minPrice: Number(probe.hotels[0]?.min_price ?? 0), firstDeparture: String(result.hotels[0]?.best_offer?.departure_date ?? ''), today: todayStr });
  row('route', `${route.page}`, `${route.page}`);
  row('title', liveTitle, landingTitle(ctx));
  row('h1', liveH1, ctx.h1);
  row('description', liveDesc, desc);
  const mine = [...h2s(ctx.seo_text)];
  const missing = mine.filter((h) => !liveH2.includes(h));
  console.log(`| ${p} | h2 z seo_text na živé stránce | ${mine.length - missing.length}/${mine.length} | ${missing.length ? 'chybí: ' + missing.join(' ; ') : ''} | ${missing.length ? 'NE' : 'ano'} |`);
  console.log(`| ${p} | robots / total | ${liveRobots} | ${result.total >= Math.max(1, ctx.index_min ?? 1) ? 'index' : 'noindex'} (total ${result.total}) | - |`);
  const alias = canonicalAliasTarget(p); if (alias) console.log(`| ${p} | alias | - | ${alias} | - |`);
  void getTopic;
}
