// Meta + JSON-LD for product pages, ported from Kakapo_Seo (meta(), print_json_ld()). Titles/descriptions are the PHP ones.
import { cleanProductTitle, formatPrice, partnerLabel } from '../helpers';
import { categoryLabel, getCategory } from './data';
import type { Faq } from './data';
import type { ProductRow } from './repo';

export const TITLE_MAX = 60;
export const DESC_MAX = 158;
export interface Crumb { label: string; url?: string }
export interface PageMeta {
  title: string; description: string; canonical: string; robots: string[]; image?: string | undefined; jsonLd: unknown[]; breadcrumbs: Crumb[];
}
const WS = /[ \t\r\n\f\v]+/g; // PHP \s (no /u): does NOT match U+00A0 used in prices

export const stripTags = (s: string) => String(s ?? '').replace(/<[^>]*>/g, '');

export function cutWords(txt: string, max: number): string {
  txt = txt.trim();
  const chars = [...txt];
  if (chars.length <= max) return txt;
  const cut = chars.slice(0, max - 1).join('');
  const sp = cut.lastIndexOf(' ');
  const out = sp !== -1 && [...cut.slice(0, sp)].length > Math.trunc(max * 0.5) ? cut.slice(0, sp) : cut;
  return out.replace(/[ ,;:\-–—.]+$/u, '') + '…';
}
export function snippetText(raw: string, max: number): string {
  let t = stripTags(raw).replace(WS, ' ').trim();
  t = t.replace(/^\s*Popis:\s*/iu, '');
  t = t.replace(/^(?:\p{Lu}{2,}[ \t\r\n:]+){1,4}/u, '').trim();
  return t === '' ? '' : cutWords(t, max);
}
export function productTitle(name: string, place: string, price: string): string {
  name = name.trim(); place = place.trim();
  const len = (s: string) => [...s].length;
  const brand = ' | Kakapo.cz';
  let title = name;
  if (len(title + price) <= TITLE_MAX) title += price;
  if (place !== '' && len(title + ' — ' + place) <= TITLE_MAX) title += ' — ' + place;
  if (len(title + brand) <= TITLE_MAX) title += brand;
  return len(title) > TITLE_MAX ? cutWords(name, TITLE_MAX) : title;
}

const abs = (site: string, path: string) => site.replace(/\/$/, '') + path;
const absImage = (site: string, img: string | undefined) => (img ? (/^https?:\/\//i.test(img) ? img : abs(site, img)) : undefined);

const questionList = (faqs: Faq[]) => faqs
  .map((f) => ({ q: stripTags(String(f.q ?? '')).trim(), a: stripTags(String(f.a ?? '')) }))
  .filter((f) => f.q !== '' && f.a !== '')
  .map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }));

const ld = (graphs: unknown[]) => ({ '@context': 'https://schema.org', '@graph': graphs });
const breadcrumbLd = (site: string, canonical: string, crumbs: Crumb[]) => ({
  '@type': 'BreadcrumbList', '@id': canonical + '#breadcrumb',
  itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.label, ...(c.url ? { item: abs(site, c.url) } : {}) })),
});
export function itemListLd(site: string, products: ProductRow[]) {
  const li = products.slice(0, 12).map((p, i) => ({
    '@type': 'ListItem', position: i + 1, url: abs(site, `/zazitek/${p.slug}/`), name: cleanProductTitle(p.title, p.partner_slug ?? ''),
    ...(p.image_url ? { image: p.image_url } : {}),
  }));
  return li.length ? { '@type': 'ItemList', itemListElement: li } : null;
}

export function hubMeta(site: string, top12: ProductRow[]): Omit<PageMeta, 'jsonLd'> & { jsonLd: unknown[] } {
  const canonical = abs(site, '/objevte/');
  const crumbs: Crumb[] = [{ label: 'Domů', url: '/' }, { label: 'Objevte' }];
  const graphs: unknown[] = [breadcrumbLd(site, canonical, crumbs)];
  const il = itemListLd(site, top12); if (il) graphs.push(il);
  return {
    title: 'Objevte — poznávací a vzdělávací zájezdy, pobyty i plavby | Kakapo.cz',
    description: 'Nejen hotely. Prohlédněte si poznávací a vzdělávací zájezdy, zážitky, wellness pobyty, plavby a eurovíkendy od prověřených partnerů na jednom místě.',
    canonical, robots: ['index', 'follow'], image: abs(site, '/wp-content/kakapo-assets/img/cat/zazitky.webp'),
    breadcrumbs: crumbs, jsonLd: [ld(graphs)],
  };
}
/** The hub template prints its own FAQPage script in addition to the graph. */
export const hubFaqLd = (faqs: Faq[]) => ({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: questionList(faqs) });

export function categoryMeta(site: string, a: {
  type: string; landing: { label: string; path: string; title?: string; description?: string; intro: string; faqs?: Faq[]; index_min?: number } | null;
  total: number; filtered: boolean; top12: ProductRow[];
}): PageMeta {
  const cat = getCategory(a.type); const landing = a.landing;
  const path = landing ? landing.path : cat.path;
  const canonical = abs(site, `/${path}/`);
  const indexMin = landing ? Math.max(1, Math.trunc(landing.index_min ?? 1)) : 1;
  const robots = a.total >= indexMin && !a.filtered ? ['index', 'follow'] : ['noindex', 'follow'];
  const crumbs: Crumb[] = [{ label: 'Domů', url: '/' }, { label: 'Objevte', url: '/objevte/' }, { label: landing ? landing.label : categoryLabel(a.type) }];
  const graphs: unknown[] = [breadcrumbLd(site, canonical, crumbs)];
  if (!robots.includes('noindex')) {
    const faqs = landing && landing.faqs?.length ? landing.faqs : cat.faqs ?? [];
    const items = questionList(faqs); if (items.length) graphs.push({ '@type': 'FAQPage', mainEntity: items });
    const il = itemListLd(site, a.top12); if (il) graphs.push(il);
  }
  return {
    title: landing ? String(landing.title ?? `${landing.label} | Kakapo.cz`) : `${cat.label} — porovnejte nabídky | Kakapo.cz`,
    description: landing ? String(landing.description ?? landing.intro) : cat.intro,
    canonical, robots, image: absImage(site, cat.photo), breadcrumbs: crumbs, jsonLd: [ld(graphs)],
  };
}

export function productMeta(site: string, p: ProductRow, faqs: Faq[], today: string): PageMeta {
  const ctitle = cleanProductTitle(p.title, p.partner_slug ?? '');
  const place = [p.destination, p.country].filter(Boolean).join(', ');
  const price = ' od ' + formatPrice(p.price);
  const parts = [
    ctitle + (place ? ' v lokalitě ' + place : '') + price + '.',
    categoryLabel(p.type) + (partnerLabel(p.partner_slug ?? '') !== '' ? ' od ' + partnerLabel(p.partner_slug ?? '') : '') + '.',
  ];
  const lead = snippetText(String(p.description ?? ''), 95);
  parts.push(lead !== '' ? lead : 'Termíny, cena a odkaz na ověřeného partnera na Kakapo.cz.');
  const description = cutWords(parts.join(' ').replace(WS, ' ').trim(), DESC_MAX);
  const canonical = abs(site, `/zazitek/${p.slug}/`);
  const cat = getCategory(p.type);
  const crumbs: Crumb[] = [{ label: 'Domů', url: '/' }, { label: 'Objevte', url: '/objevte/' }, { label: cat.label, url: `/${cat.path}/` }, { label: ctitle }];

  const nowMs = Date.parse(today + 'T00:00:00Z');
  const future = (d: string | null) => !!d && Date.parse(d + 'T00:00:00Z') >= nowMs;
  const validUntil = future(p.date_to) ? String(p.date_to) : future(p.date_from) ? String(p.date_from) : new Date(nowMs + 30 * 864e5).toISOString().slice(0, 10);
  const product: Record<string, unknown> = {
    '@type': 'Product', name: ctitle, url: canonical, category: cat.label,
    offers: {
      '@type': 'Offer', priceCurrency: p.currency || 'CZK', price: String(Math.trunc(p.price)), availability: 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition', priceValidUntil: validUntil, url: canonical,
    } as Record<string, unknown>,
  };
  if (p.images.length) product.image = p.images.slice(0, 5);
  if (String(p.description ?? '').trim() !== '') {
    product.description = [...stripTags(String(p.description)).replace(/^\s*Popis:\s*/iu, '').replace(WS, ' ').trim()].slice(0, 300).join('');
  }
  if (p.external_id) product.sku = String(p.external_id);
  if (p.country || p.destination || p.place) product.areaServed = { '@type': 'Place', name: [p.place ?? '', p.destination ?? '', p.country ?? ''].filter(Boolean).join(', ') };
  if (p.partner_slug) {
    const pn = partnerLabel(p.partner_slug);
    product.brand = { '@type': 'Brand', name: pn };
    (product.offers as any).seller = { '@type': 'Organization', name: pn };
    product.provider = { '@type': 'Organization', name: pn };
  }
  if (p.date_from) (product.offers as any).availabilityStarts = String(p.date_from);
  if (p.date_to) (product.offers as any).availabilityEnds = String(p.date_to);
  const graphs: unknown[] = [breadcrumbLd(site, canonical, crumbs), product];
  const items = questionList(faqs); if (items.length) graphs.push({ '@type': 'FAQPage', mainEntity: items });
  return {
    title: productTitle(ctitle, place, price), description, canonical, robots: ['index', 'follow'],
    image: absImage(site, p.image_url ?? p.images[0]), breadcrumbs: crumbs, jsonLd: [ld(graphs)],
  };
}

export function legalMeta(site: string, slug: string, label: string, description: string): PageMeta {
  const canonical = abs(site, `/${slug}/`);
  const crumbs: Crumb[] = [{ label: 'Domů', url: '/' }, { label }];
  return { title: `${label} | Kakapo.cz`, description, canonical, robots: ['index', 'follow'], breadcrumbs: crumbs, jsonLd: [ld([breadcrumbLd(site, canonical, crumbs)])] };
}
