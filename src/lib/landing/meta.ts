// SEO meta rules for landings (Kakapo_Seo: title_budget, landing_title, landing_description, indexability).
import { formatPrice } from '../helpers';
import { nf } from './util';

export const TITLE_MAX = 60;
export const DESC_MAX = 158;
export const MIN_INDEX_RESULTS = 12;
const BRAND = ' | Kakapo.cz';
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const len = (s: string) => [...s].length;

/** Title in the TITLE_MAX budget: core has priority, suffix and brand are added only when they fit. */
export function titleBudget(coreIn: string): string {
  const core = decode(coreIn.trim());
  for (const extra of [' — ceny a termíny', ' — ceny', '']) if (len(core + extra + BRAND) <= TITLE_MAX) return core + extra + BRAND;
  for (const extra of [' — ceny a termíny', ' — ceny']) if (len(core + extra) <= TITLE_MAX) return core + extra;
  return core;
}

/** landing_title(): a hand-written title is kept while it fits, otherwise rebuilt from the H1. */
export function landingTitle(ctx: { title?: string; h1?: string }): string {
  const title = decode((ctx.title ?? '').trim());
  if (title !== '' && len(title) <= TITLE_MAX) return title;
  let core = (ctx.h1 ?? '').trim();
  // the long hand-written title carried the season year ("Dovolená u moře 2027: kam jet…"); keep it in the rebuilt one
  const year = /(?<![\d.\/-])(20\d\d)(?![\d\/-])/.exec(title)?.[1];
  if (year && core !== '' && !/\b20\d\d\b/.test(core)) {
    const withYear = `${core} ${year}`;
    if (len(withYear + ' — ceny' + BRAND) <= TITLE_MAX || len(withYear + BRAND) <= TITLE_MAX) core = withYear;
  }
  return core !== '' ? titleBudget(core) : title;
}

/**
 * landing_description(): live numbers instead of the stored text. The stored description is only the
 * fallback when there are no results — so an override of `description` never reaches the SERP on a populated page.
 */
export function landingDescription(ctx: { description?: string; h1?: string; filters?: { sort?: string } }, total: number, probe: { minPrice?: number; firstDeparture?: string; today?: string } = {}): string {
  const base = ctx.description ?? ''; const label = (ctx.h1 ?? '').trim();
  if (total <= 0 || label === '') return base;
  const word = total === 1 ? 'hotel' : total >= 2 && total <= 4 ? 'hotely' : 'hotelů';
  let head = `${label}: ${nf(total)} ${word}`;
  if ((probe.minPrice ?? 0) > 0) head += ' od ' + formatPrice(probe.minPrice!);
  if (ctx.filters?.sort === 'departure' && probe.firstDeparture && probe.today && probe.firstDeparture >= probe.today) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(probe.firstDeparture);
    if (m) head += `, odlety od ${Number(m[3])}. ${Number(m[2])}.`;
  }
  head = head.replace(/[. ]+$/, '');
  let desc = head + '. Porovnejte a rezervujte přímo u pořadatele bez příplatku.';
  if (len(desc) > DESC_MAX) desc = head + '. Rezervace přímo u pořadatele.';
  return len(desc) > DESC_MAX ? [...desc].slice(0, DESC_MAX - 1).join('').trimEnd() + '…' : desc;
}

/**
 * Robots decision shared by landings and topics: index only with enough results, no query string
 * and (landings) no canonical alias. `hasQuery` = any GET parameter at all.
 */
export function isIndexable(ctx: { index_min?: number }, total: number, opts: { hasQuery?: boolean; aliasTarget?: string } = {}): boolean {
  return total >= Math.max(1, ctx.index_min ?? 1) && !opts.hasQuery && !opts.aliasTarget;
}
