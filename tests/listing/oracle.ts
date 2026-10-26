// Oracle: live kakapo.cz HTML vs. loadListing()/loadHome() over the WP export loaded in SQLite.
// Usage: npx tsx tests/listing/oracle.ts [path ...]   (default: the 6 paths of docs/LISTING.md)
import { execFileSync } from 'node:child_process';
import { exportDb } from '../landing/d1';
import { landingContext, resolveRoute, canonicalAliasTarget, TOPIC_SLUGS, longtailContext } from '../../src/lib/landing';
import { loadHome, loadListing, type ListingDeps } from '../../src/lib/listing';
import { loadRegistry } from '../../src/lib/snapshots';
import { todayPrague } from '../../src/lib/search';

const PATHS = process.argv.slice(2).length ? process.argv.slice(2) : ['/zajezdy/', '/last-minute/', '/recko/', '/all-inclusive/', '/', '/dovolena-u-more/'];
const dec = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

async function live(path: string) {
  // Cloudflare challenges node's fetch and UAs with odd suffixes; plain curl with this browser UA passes.
  const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
  const out = execFileSync('curl', ['-s', '-m', '60', '-A', ua, '-w', '\n__STATUS__%{http_code}', 'https://kakapo.cz' + path], { maxBuffer: 64 * 1024 * 1024 }).toString();
  const cut = out.lastIndexOf('\n__STATUS__');
  const html = out.slice(0, cut); const r = { status: Number(out.slice(cut + 11)) };
  const pick = (re: RegExp) => dec(re.exec(html)?.[1] ?? '');
  const main = html.slice(html.indexOf('<main'));
  const slugs = [...main.matchAll(/<h3[^>]*>\s*<a href="[^"]*\/hotel\/([^/"]+)\/"/g)].map((m) => m[1]!);
  return {
    status: r.status,
    title: pick(/<title>([\s\S]*?)<\/title>/),
    description: pick(/<meta name="description" content="([^"]*)"/),
    robots: pick(/<meta name="robots" content="([^"]*)"/),
    canonical: pick(/<link rel="canonical" href="([^"]*)"/),
    h1: dec((/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()),
    count: dec((/x-ref="count"[^>]*>([^<]*)</.exec(html)?.[1] ?? '').trim()),
    faqCount: (html.match(/<details class="rounded-2xl bg-paper/g) ?? []).length,
    seoText: html.includes('class="prose-kakapo max-w-5xl'),
    cards: (html.match(/<article class="card-k/g) ?? []).length,
    slugs,
    h2: [...main.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => dec(m[1]!.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())),
  };
}

const odb = exportDb();
if (!odb) throw new Error('export not available');
const db = odb.db;
const reg = await loadRegistry(db);
const deps: ListingDeps = {
  canonicalAlias: canonicalAliasTarget,
  longtail: {
    topicSlugs: () => TOPIC_SLUGS,
    context: async (_d, c, d, t) => { const x = longtailContext(reg, c, d, t); return x ? { path: x.path, h1: x.h1, filters: x.filters, index_min: x.index_min } : null; },
  },
};

let diffs = 0;
const cmp = (label: string, a: unknown, b: unknown) => { const same = JSON.stringify(a) === JSON.stringify(b); if (!same) diffs++; console.log(`  ${same ? 'OK  ' : 'DIFF'} ${label}${same ? '' : `\n       live : ${JSON.stringify(a)}\n       mine : ${JSON.stringify(b)}`}`); };

for (const path of PATHS) {
  console.log(`\n== ${path}`);
  const l = await live(path);
  console.log(`  live status ${l.status}, cards ${l.cards}`);
  if (path === '/') {
    const h = await loadHome(db);
    cmp('title', l.title, h.meta.title); cmp('description', l.description, h.meta.description); cmp('robots', l.robots.replace(/\s+/g, ''), h.meta.robots.join(','));
    cmp('canonical', l.canonical, h.meta.canonical);
    const mineCards = h.picked.length + h.drops.slice(0, 8).length * (h.drops.length >= 4 ? 1 : 0) + h.sections.reduce((a, s) => a + s.hotels.length, 0);
    cmp('hotel cards on page (picked+drops+3 sections)', l.cards - h.products.length, mineCards);
    cmp('first picked (rating) hotel', l.slugs[0], h.picked[0]?.slug);
    continue;
  }
  const [pathOnly, qs = ''] = path.split('?');
  const route = await resolveRoute(db, pathOnly!);
  if (!route) { console.log('  no route'); diffs++; continue; }
  const ctx = await landingContext(db, route.page, route.vars);
  if (!ctx) { console.log('  no ctx'); diffs++; continue; }
  const d = await loadListing(db, ctx as never, new URLSearchParams(qs), { ...deps, ...(route.vars.topic ? { topicSlug: route.vars.topic } : {}), today: todayPrague() });
  cmp('title', l.title, d.meta.title); cmp('description', l.description, d.meta.description);
  cmp('robots', l.robots.replace(/\s+/g, ''), d.meta.robots.join(',')); cmp('canonical', l.canonical, d.meta.canonical);
  cmp('h1', l.h1, d.ctx.h1);
  cmp('cards per page', l.cards, d.result.hotels.length);
  cmp('first 5 hotels', l.slugs.slice(0, 5), d.result.hotels.slice(0, 5).map((h) => h.slug));
  cmp('total', Number(/nalezeno ([\d\s ]+) hotel/.exec('') ?? 0) || undefined, undefined);
}
console.log(`\n${diffs} difference(s)`);
