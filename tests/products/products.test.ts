import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1, seedProducts } from './d1shim';
import { resolveProductRoute, loadCategory, loadDetail, loadHub, categoryUrl, legalMeta, LEGAL_HTML, LEGAL_DESCRIPTIONS, LEGAL_LABELS } from '../../src/lib/products';
import { cutWords, productTitle, snippetText } from '../../src/lib/products/meta';
import { productRepo } from '../../src/lib/products';
import { foldText } from '../../src/lib/products/search-text';

const SITE = 'https://kakapo.cz';
let t = makeD1();
beforeEach(() => { t = makeD1(); seedProducts(t.raw); });

describe('resolveProductRoute', () => {
  it('maps hub, category path, landing slug', async () => {
    expect(await resolveProductRoute(t.db, '/objevte/')).toEqual({ kind: 'hub' });
    expect(await resolveProductRoute(t.db, '/poznavaci-zajezdy/')).toMatchObject({ kind: 'category', type: 'poznavaci' });
    expect(await resolveProductRoute(t.db, '/adventni-zajezdy')).toMatchObject({ kind: 'landing', type: 'eurovikendy' });
  });
  it('returns null for paths outside the section', async () => {
    for (const p of ['/', '/recko/', '/hotel/x/', '/zajezdy/', '/zazitek/', '/zazitek/a/b/']) expect(await resolveProductRoute(t.db, p)).toBeNull();
  });
  it('serves an active product', async () => {
    const r = await resolveProductRoute(t.db, '/zazitek/eurovikend-rim/');
    expect(r).toMatchObject({ kind: 'product', slug: 'eurovikend-rim' });
  });
  it('hidden, inactive and unknown products are notfound (live PHP behaviour = 404)', async () => {
    for (const s of ['skryty', 'neaktivni', 'neexistuje', 'BAD SLUG', '..%2f']) expect(await resolveProductRoute(t.db, `/zazitek/${s}/`)).toEqual({ kind: 'notfound' });
  });
  it('optional redirectGone sends inactive (not hidden) products to their category with 302', async () => {
    expect(await resolveProductRoute(t.db, '/zazitek/neaktivni/', { redirectGone: true })).toEqual({ kind: 'redirect', status: 302, location: '/eurovikendy/' });
    expect(await resolveProductRoute(t.db, '/zazitek/skryty/', { redirectGone: true })).toEqual({ kind: 'notfound' });
  });
});

describe('repository', () => {
  it('never lists hidden/inactive products and counts only visible ones', async () => {
    const r = await productRepo.search(t.db, { type: 'eurovikendy' });
    expect(r.products.map((p) => p.slug).sort()).toEqual(['eurovikend-pariz', 'eurovikend-rim']);
    expect((await productRepo.countsByType(t.db)).eurovikendy!.cnt).toBe(2);
    expect(await productRepo.getBySlug(t.db, 'skryty')).toBeNull();
    expect(await productRepo.getBySlug(t.db, 'neaktivni')).toBeNull();
    expect((await productRepo.getBySlugAny(t.db, 'neaktivni'))?.active).toBe(0);
  });
  it('search is accent- and case-insensitive (MySQL ci collation parity)', async () => {
    for (const q of ['řím', 'RIM', 'Rim', 'paříž', 'PARIZ']) {
      const r = await productRepo.search(t.db, { type: 'eurovikendy', q });
      expect(r.total, q).toBe(1);
    }
    expect(foldText('Řím Šťastná')).toBe('rim stastna');
  });
  it('search_text trigger follows updates', async () => {
    t.raw.exec("UPDATE products SET title = 'Zámek Hluboká' WHERE id = 2");
    expect((await productRepo.search(t.db, { q: 'hluboka' })).total).toBe(1);
  });
  it('filterOptions drops numeric type_raw codes', async () => {
    const o = await productRepo.filterOptions(t.db, 'wellness');
    expect(o.kinds.map((k) => k.type_raw)).toEqual(['Wellness víkend']);
    expect(o.places.map((p) => p.place).sort()).toEqual(['Lednice', 'Praha']);
    expect(o.price).toEqual({ min: 2990, max: 3990 });
  });
  it('similar prefers same country and excludes self', async () => {
    const p = (await productRepo.getBySlug(t.db, 'eurovikend-rim'))!;
    expect((await productRepo.similar(t.db, p, 4)).map((x) => x.slug)).toEqual(['eurovikend-pariz']);
  });
});

describe('meta', () => {
  it('product meta fits title/description budgets and has Product JSON-LD', async () => {
    const p = (await productRepo.getBySlug(t.db, 'eurovikend-rim'))!;
    const d = await loadDetail(t.db, SITE, p, '2026-10-26');
    const m = d.meta;
    expect([...m.title].length).toBeLessThanOrEqual(60);
    expect([...m.description].length).toBeLessThanOrEqual(158);
    expect(m.canonical).toBe('https://kakapo.cz/zazitek/eurovikend-rim/');
    expect(m.robots).toEqual(['index', 'follow']);
    expect(m.description).toContain('Eurovíkend ŘÍM');
    expect(m.description).not.toMatch(/POLOHA UBYTOVÁNÍ/); // upper-case feed headings stripped
    const graph = (m.jsonLd[0] as any)['@graph'];
    const prod = graph.find((g: any) => g['@type'] === 'Product');
    expect(prod.offers.price).toBe('5990'); expect(prod.offers.priceCurrency).toBe('CZK'); expect(prod.offers.priceValidUntil).toBe('2026-12-08');
    expect(prod.brand.name).toBe('Invia'); expect(graph.some((g: any) => g['@type'] === 'FAQPage')).toBe(true);
    expect(graph.find((g: any) => g['@type'] === 'BreadcrumbList')['@id']).toBe('https://kakapo.cz/zazitek/eurovikend-rim/#breadcrumb');
  });
  it('detail only lists future terms and keeps sponsored go links with partner/price attributes data', async () => {
    const p = (await productRepo.getBySlug(t.db, 'eurovikend-rim'))!;
    const d = (await loadDetail(t.db, SITE, p, '2026-10-26')).detail;
    expect(d.hasTerms).toBe(true); expect(d.rows.map((r) => r.price)).toEqual([5990]);
    expect(d.goUrl).toBe(`/akce/${p.id}/?ctx=product-detail`);
  });
  it('category: indexable unfiltered, noindex with filter params', async () => {
    const a = await loadCategory(t.db, SITE, { type: 'eurovikendy' }, new URLSearchParams());
    expect(a.meta.robots).toEqual(['index', 'follow']); expect(a.meta.canonical).toBe('https://kakapo.cz/eurovikendy/');
    const b = await loadCategory(t.db, SITE, { type: 'eurovikendy' }, new URLSearchParams('sort=price_desc'));
    expect(b.meta.robots).toEqual(['noindex', 'follow']); expect(b.hasFilters).toBe(false);
    const c = await loadCategory(t.db, SITE, { type: 'eurovikendy' }, new URLSearchParams('zeme=italie&cena=3000-8000'));
    expect(c.hasFilters).toBe(true); expect(c.res.total).toBe(1);
    expect(c.meta.title).toBe('Eurovíkendy — porovnejte nabídky | Kakapo.cz'.replace('Eurovíkendy', a.cat.label));
  });
  it('landing honours locked q filter and index_min', async () => {
    const rim = await loadCategory(t.db, SITE, { type: 'eurovikendy', landing: (await resolveProductRoute(t.db, '/eurovikend-rim/') as any).landing }, new URLSearchParams());
    expect(rim.res.total).toBe(1); expect(rim.meta.robots).toEqual(['index', 'follow']);
    const wl = await loadCategory(t.db, SITE, { type: 'wellness', landing: (await resolveProductRoute(t.db, '/wellness-pobyt-pro-dva/') as any).landing }, new URLSearchParams());
    expect(wl.meta.robots).toEqual(['noindex', 'follow']); // index_min 8 > 1 result
  });
  it('hub counts only visible products and emits FAQ JSON-LD', async () => {
    const h = await loadHub(t.db, SITE);
    expect(h.total).toBe(4); expect(h.extraJsonLd).toHaveLength(1);
    expect(h.meta.canonical).toBe('https://kakapo.cz/objevte/');
  });
  it('legal pages: verbatim copy and meta', () => {
    for (const s of Object.keys(LEGAL_LABELS)) {
      const m = legalMeta(SITE, s, LEGAL_LABELS[s]!, LEGAL_DESCRIPTIONS[s]!);
      expect(m.title).toBe(`${LEGAL_LABELS[s]} | Kakapo.cz`); expect(m.canonical).toBe(`https://kakapo.cz/${s}/`); expect(LEGAL_HTML[s]).toContain('<h2>');
    }
  });
});

describe('helpers', () => {
  it('categoryUrl keeps current params and drops empty overrides', () => {
    expect(categoryUrl('/x/', { zeme: 'italie', cena: '0-3000' }, { cena: '' })).toBe('/x/?zeme=italie');
    expect(categoryUrl('/x/', {}, { strana: 3 })).toBe('/x/?strana=3');
    expect(categoryUrl('/x/', {}, {})).toBe('/x/');
  });
  it('cutWords / productTitle / snippetText', () => {
    expect(cutWords('abc def ghi jkl', 9)).toBe('abc def…');
    expect([...productTitle('RICHARD - Mariánské Lázně', 'Západní Čechy, Česko', ' od 8 440 Kč')].length).toBeLessThanOrEqual(60);
    expect(snippetText('Popis: POLOHA UBYTOVÁNÍ Hotel je v centru.', 95)).toBe('Hotel je v centru.');
  });
});

describe('term links', () => {
  it('?t= is the index in the original meta.terms (PHP passed the index of the filtered list)', async () => {
    t.raw.exec(`UPDATE products SET meta_json = '{"terms":[{"from":"2025-01-01","to":"2025-01-04","nights":3,"price":4000},{"from":"2026-12-05","to":"2026-12-08","nights":3,"price":5990}]}' WHERE id = 1`);
    const { termGoUrl } = await import('../../src/lib/products/content');
    const p = (await productRepo.getBySlug(t.db, 'eurovikend-rim'))!;
    const d = (await loadDetail(t.db, SITE, p, '2026-10-26')).detail;
    expect(termGoUrl(d, 0)).toBe(`/akce/${p.id}/?ctx=product-term&t=1`);
  });
});
