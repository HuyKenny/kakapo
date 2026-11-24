// Browser glue of the static listing filters: loads /data/zajezdy/*.json lazily (only when a filter is used or present in
// the URL) and exposes window.kakapoListing.run() to the Alpine component kakapoFilters (public/.../js/frontend.js).
import { todayPrague } from '../search';
import { cardQuery, decodeShard, facetCounts, mergeParams, renderCard, search, shardsFor, type DataIndex, type Hotel } from './engine';

const BASE = '/data/zajezdy/';
let indexP: Promise<DataIndex> | null = null;
const shards = new Map<string, Promise<Hotel[]>>();

const getJson = async (url: string): Promise<any> => {
  const r = await fetch(url, { credentials: 'omit' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
};
const loadIndex = () => (indexP ??= getJson(BASE + 'index.json').catch((e) => { indexP = null; throw e; }));
function loadShard(name: string): Promise<Hotel[]> {
  let p = shards.get(name);
  if (!p) {
    p = getJson(`${BASE}${name}.json`).then(decodeShard).catch((e) => { shards.delete(name); throw e; });
    shards.set(name, p);
  }
  return p;
}

export interface RunOut { total: number; pages: number; page: number; html: string; facets: { groups: string[]; counts: Record<string, number> } }

/** params = landing filters overridden by the form/URL (same keys as the old /api/search), urlQuery = what the address bar shows. */
async function run(pathFilters: Record<string, unknown>, params: Record<string, string>, page: number, urlQuery: string): Promise<RunOut> {
  const index = await loadIndex();
  const f = mergeParams(pathFilters ?? {}, params ?? {}, page);
  const names = shardsFor(f, index);
  const hotels = (await Promise.all(names.map(loadShard))).flat();
  const today = todayPrague();
  const res = search(hotels, f, today, index.stale);
  const q = cardQuery(urlQuery);
  return {
    total: res.total, pages: res.pages, page: res.page,
    html: res.items.map((it) => renderCard(it.hotel, it.best, q)).join(''),
    facets: facetCounts(hotels, f, !f.country && names.length === index.shards.length),
  };
}

declare global { interface Window { kakapoListing?: { run: typeof run } } }
window.kakapoListing = { run };
document.dispatchEvent(new CustomEvent('kakapo:listing'));
