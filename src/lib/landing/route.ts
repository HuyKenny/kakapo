// Routing for landing pages: Kakapo_Router rewrite rules + resolve_country_urls, legacy redirects and canonical aliases.
import aliases from '../../data/landing-aliases.json';
import { slugify } from '../helpers';
import { COUNTRY_PREFIX_ALIASES } from './country-aliases';
import { loadRegistry, isCountry, isDestination } from '../snapshots';
import { existsTopic as longtailExists } from './longtail';
import { topicExists } from './topics';
import type { LandingVars } from './pages';

export const MEAL_LANDINGS = ['all-inclusive', 'polopenze', 'snidane', 'bez-stravy', 'plna-penze'];
export interface Route { page: string; vars: LandingVars }

const PREFIX_ALIASES: Array<[string, string]> = [
  ['/destinace/mexiko/', '/mexiko/'], ['/destinace/', '/mexiko/'], // feed placeholder country "Destinace" (hotels are in Mexico)
  ['/egypt/egypt-hurghada/', '/egypt/hurghada/'], ['/egypt/egypt-marsa-alam/', '/egypt/marsa-alam/'], ['/egypt/marsa-matrouh/', '/egypt/marsa-matruh/'],
  ['/tunisko/tunisko-pevnina/', '/tunisko/pevnina/'], ['/kypr/kypr/', '/kypr/'], ['/maledivy/maledivy/', '/maledivy/'], ['/mauricius/mauricius/', '/mauricius/'],
  ['/mexiko/mexiko/', '/mexiko/'], ['/tunisko/tunisko/', '/tunisko/'], ['/kapverdy/kapverdy/', '/kapverdy/'], ['/seychely/seychely/', '/seychely/'],
  ['/albanie/albanie/', '/albanie/'], ['/vietnam/vietnam/', '/vietnam/'], ['/cerna-hora/cerna-hora/', '/cerna-hora/'], ['/oman/oman/', '/oman/'], ['/kena/kena/', '/kena/'],
  ['/malta/malta/', '/malta/'], ['/japonsko/japonsko/', '/japonsko/'], ['/jamajka/jamajka/', '/jamajka/'], ['/finsko/finsko/', '/finsko/'], ['/sri-lanka/sri-lanka/', '/sri-lanka/'],
  ['/cina/cina/', '/cina/'], ['/bahrajn/bahrajn/', '/bahrajn/'], ['/katar/katar/', '/katar/'], ['/bahrain/bahrain/', '/bahrajn/'], ['/kostarika/kostarika/', '/kostarika/'],
  ['/irsko/irsko/', '/irsko/'], ['/singapur/singapur/', '/singapur/'],
];

/** Kakapo_Seo::canonical_alias_target — '' when the path is not an alias. */
export function canonicalAliasTarget(pathIn: string): string {
  const path = '/' + pathIn.replace(/^\/+|\/+$/g, '') + '/';
  const exact = (aliases as Record<string, string>)[path];
  if (exact) return exact;
  for (const [from, to] of PREFIX_ALIASES) if (path.startsWith(from)) return to + path.slice(from.length);
  for (const [from, to] of Object.entries(COUNTRY_PREFIX_ALIASES)) {
    const prefix = `/${from}/`;
    if (!path.startsWith(prefix)) continue;
    let suffix = path.slice(prefix.length);
    if (suffix.startsWith('ostrov-sal/')) suffix = 'sal/' + suffix.slice('ostrov-sal/'.length);
    else if (suffix.startsWith('ostrov-boa-vista/')) suffix = 'boa-vista/' + suffix.slice('ostrov-boa-vista/'.length);
    return `/${to}/${suffix}`;
  }
  return '';
}

/** Kakapo_Router::redirect_legacy — 301 targets (query string is preserved by the caller). */
export function legacyRedirect(pathIn: string): string {
  const path = pathIn.replace(/\/+$/, '');
  if (path === '/dovolena') return '/zajezdy/';
  if (path === '/dovolena-i-more') return '/dovolena-u-more/';
  if (path === '/vlastni-dopravou') return '/dovolena-vlastni-dopravou/';
  if (path !== '' && !path.startsWith('/go') && !path.startsWith('/akce')) {
    const alias = canonicalAliasTarget(path);
    if (alias !== '' && alias.replace(/\/+$/, '') !== path) return alias;
  }
  return '';
}

/** Resolve a request path to a landing page. null = not a landing (the caller tries other routers: hotels, products, legal…). */
export async function resolveRoute(db: D1Database, pathname: string): Promise<Route | null> {
  const clean = pathname.replace(/^\/+|\/+$/g, '');
  if (clean === '') return null;
  const seg = clean.split('/');
  if (seg.length === 1) {
    const s = seg[0]!;
    if (s === 'zajezdy') return { page: 'search', vars: {} };
    if (s === 'last-minute' || s === 'first-minute' || s === 'zlevneno') return { page: 'flag', vars: { flag: s } };
    if (MEAL_LANDINGS.includes(s)) return { page: 'meal', vars: { meal: s } };
    const m = /^odlet-z-([^/]+)$/.exec(s);
    if (m) return { page: 'airport', vars: { airport: m[1]! } };
    if (topicExists(s)) return { page: 'topic', vars: { topic: s } };
  }
  if (seg.length > 3) return null;
  const reg = await loadRegistry(db);
  const country = slugify(seg[0]!);
  if (!isCountry(reg, country)) return null;
  if (seg.length === 1) return { page: 'country', vars: { country } };
  if (seg.length === 2) {
    const dest = slugify(seg[1]!);
    if (longtailExists(dest)) return { page: 'longtail', vars: { country, ltopic: dest } };
    if (!isDestination(reg, country, dest)) return null;
    return { page: 'country', vars: { country, dest } };
  }
  const dest = slugify(seg[1]!); const topic = slugify(seg[2]!);
  if (!isDestination(reg, country, dest) || !longtailExists(topic)) return null;
  return { page: 'longtail', vars: { country, dest, ltopic: topic } };
}
