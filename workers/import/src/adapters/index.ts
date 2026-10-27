// Adapter registry: turns a feed row into a stream of raw items. One adapter family per feed format;
// all of them end in the same normalisation gate (normalize.ts) and the same model (model.ts).
import type { Deps } from '../deps';
import type { FeedRow } from '../model';
import { decodeXmlStream, parseXmlItems, XmlError, DEFAULT_LIMITS } from '../xml/stream';
import { mapItem, productIncluded, type Mapping, type RawHotelItem, type RawProductItem } from '../xml/mapper';
import { fetchCjPage, mapCjHotel, mapCjProduct, cjProductSlug, CJ_PAGE_SIZE, type CjConfig } from './cj';
import { openHttp, FeedFetchError } from './http';
import PRESETS from '../xml/presets.json';
import { pragueToday } from '../util/text';

export type RawItem =
  | { t: 'h'; hotel: Record<string, unknown>; offers: Array<Record<string, unknown>> }
  | { t: 'p'; product: Record<string, unknown> }
  | { t: 'bad'; external_id: string | null; reason: string };

export type Opened = { notModified: true } | { notModified?: false; items: AsyncIterable<RawItem>; etag: string | null; lastModified: string | null };

export const ADAPTERS = ['cj-atcom', 'cj-bluestyle', 'cj-tui', 'cj-generic', 'cedok-slim',
  'xml-sdovolena_tours', 'xml-sdovolena_hotels', 'xml-invia_offer', 'xml-invia_hotels', 'xml-slevomat_deals', 'xml-zbozi_product',
  'xml-adrop_pobyty', 'xml-dovolena_hotels', 'xml-dovolena_products'] as const;

/** Invia generates new offer URLs (= ids) on every run, so "missing" does not mean "gone" for the missing-ratio guard. */
export const rotatingIds = (feed: FeedRow) => /^xml-invia_/.test(feed.adapter);

export function feedMapping(feed: FeedRow): Mapping {
  let own: Partial<Mapping> = {};
  try { own = JSON.parse(feed.mapping_json || '{}'); } catch { /* fall through to preset */ }
  if (own.item && own.fields) return own as Mapping;
  const key = feed.adapter === 'cedok-slim' ? 'cedok_slim' : feed.adapter.replace(/^xml-/, '');
  const preset = (PRESETS as Record<string, unknown>)[key];
  if (!preset) throw new Error(`feed ${feed.id}: no mapping for adapter ${feed.adapter}`);
  return { ...(preset as Mapping), ...own } as Mapping;
}

export async function openFeed(feed: FeedRow, deps: Deps): Promise<Opened> {
  if (feed.adapter.startsWith('cj-')) return openCj(feed, deps);
  const mapping = feedMapping(feed);
  let body: ReadableStream<Uint8Array>; let etag: string | null = null; let lastModified: string | null = null;

  if (feed.source_kind === 'r2' || feed.adapter === 'cedok-slim') {
    const key = `inbox/feed-${feed.id}.xml`;
    const obj = (await deps.env.SNAPSHOTS.get(key)) ?? (await deps.env.SNAPSHOTS.get(key + '.gz'));
    if (!obj) throw new FeedFetchError('no uploaded snapshot in R2 inbox', false);
    if (feed.etag && feed.etag === obj.etag) return { notModified: true };
    body = obj.body; etag = obj.etag;
  } else {
    const url = (deps.env as unknown as Record<string, string | undefined>)[`FEED_URL_${feed.id}`] ?? '';
    if (url === '') throw new FeedFetchError(`secret FEED_URL_${feed.id} is not set`, false);
    const r = await openHttp(deps, url, { etag: feed.etag, lastModified: feed.last_modified });
    if (r.status === 'not_modified') return { notModified: true };
    body = r.body; etag = r.etag; lastModified = r.lastModified;
  }
  return { items: xmlItems(body, mapping, deps), etag, lastModified };
}

async function* xmlItems(body: ReadableStream<Uint8Array>, mapping: Mapping, deps: Deps): AsyncGenerator<RawItem> {
  const ctx = { today: pragueToday(deps.now()) };
  for await (const node of parseXmlItems(decodeXmlStream(body, { maxBytes: DEFAULT_LIMITS.maxTotalChars }), mapping.item)) {
    let mapped: RawHotelItem | RawProductItem;
    try { mapped = mapItem(node, mapping, ctx); }
    catch (e) { yield { t: 'bad', external_id: null, reason: 'mapping: ' + (e instanceof Error ? e.message : 'error').slice(0, 100) }; continue; }
    if ('product' in mapped) {
      if (!productIncluded(mapped.product, mapping)) { yield { t: 'bad', external_id: null, reason: 'filtered' }; continue; }
      yield { t: 'p', product: mapped.product };
    } else yield { t: 'h', hotel: mapped.hotel, offers: mapped.offers };
  }
}

async function* cjItems(feed: FeedRow, deps: Deps, cfg: CjConfig): AsyncGenerator<RawItem> {
  const secrets = { token: deps.env.CJ_API_TOKEN ?? '', cid: deps.env.CJ_CID ?? '', pid: deps.env.CJ_PID ?? '' };
  if (!secrets.token || !secrets.cid || !secrets.pid) throw new FeedFetchError('CJ secrets are not configured', false);
  const parser = cfg.parser ?? feed.adapter.replace(/^cj-/, '');
  const only = cfg.only_slugs?.length ? new Set(cfg.only_slugs) : null;
  const seenSlugs = new Set<string>();
  let offset = 0;
  for (;;) {
    let page: Awaited<ReturnType<typeof fetchCjPage>> | undefined;
    for (let attempt = 1; attempt <= 3 && !page; attempt++) {
      try { page = await fetchCjPage(deps.fetch, cfg, secrets, offset, CJ_PAGE_SIZE); }
      catch (e) { if (attempt === 3) throw new FeedFetchError(e instanceof Error ? e.message : 'CJ error', false); await deps.sleep(1000 * 2 ** (attempt - 1)); }
    }
    if (!page || page.products.length === 0) return;
    for (const p of page.products) {
      if (only) { // partner category allow-list; the feed lists a product more than once under different ids
        const slug = cjProductSlug(p.link);
        if (!only.has(slug) || seenSlugs.has(slug)) { yield { t: 'bad', external_id: String(p.id ?? ''), reason: 'filtered' }; continue; }
        seenSlugs.add(slug);
      }
      if (feed.content_type === 'products') {
        const prod = mapCjProduct(p, parser);
        yield prod ? { t: 'p', product: prod } : { t: 'bad', external_id: String(p.id ?? ''), reason: 'cj: unusable product' };
      } else {
        const m = mapCjHotel(p, parser);
        yield m ? { t: 'h', hotel: m.hotel, offers: m.offers } : { t: 'bad', external_id: String(p.id ?? ''), reason: p.isDeleted ? 'cj: deleted' : 'cj: unusable product' };
      }
    }
    offset += page.products.length;
    if (offset >= page.total) return;
  }
}
async function openCj(feed: FeedRow, deps: Deps): Promise<Opened> {
  let cfg: CjConfig = {};
  try { cfg = JSON.parse(feed.mapping_json || '{}'); } catch { /* defaults */ }
  if (!cfg.ad_id && !cfg.partner_id) throw new FeedFetchError('CJ feed has no ad_id/partner_id in its config', false);
  return { items: cjItems(feed, deps, cfg), etag: null, lastModified: null };
}
export { XmlError, FeedFetchError };
