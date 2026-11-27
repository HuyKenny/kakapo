// Port of Kakapo_Landing_Facts: numbers about a destination computed from our own offers.
import { slugify } from '../helpers';
import { themeConditionSql } from '../search';
import { loadRegistry, countryLabel as regCountryLabel, type Registry } from '../snapshots';
import { esc, formatPrice, countLabel, nightsLabel, nf, lower, monthLabel, remember, FACT_TTL_MS, type Faq } from './util';
import { pragueNow } from './dates';

export interface Range { date_from?: string; date_to?: string }
export interface Facts {
  hotels: number; offers: number; partners: number; price_min: number; price_avg: number; ai_share: number;
  nights: number[]; airports: Array<{ slug: string; label: string; cnt: number }>; month: { ym: string; mp: number } | null;
}
const today = () => { const t = pragueNow(); return `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`; };

export async function getFacts(db: D1Database, countrySlug: string, destSlug = '', range: Range = {}): Promise<Facts | null> {
  const country = slugify(countrySlug); const dest = slugify(destSlug);
  if (!country) return null;
  const from = range.date_from ?? ''; const to = range.date_to ?? '';
  return remember(`lfacts:${country}:${dest}:${from}:${to}:${today()}`, FACT_TTL_MS, async () => {
    let where = 'h.country_slug = ?'; const p: unknown[] = [country];
    if (dest) { where += ' AND (h.destination_slug = ? OR h.city_slug = ?)'; p.push(dest, dest); }
    if (from && to) { where += ' AND o.departure_date BETWEEN ? AND ?'; p.push(from, to); }
    const base = await db.prepare(`SELECT COUNT(DISTINCT h.id) AS hotels, COUNT(*) AS offers, COUNT(DISTINCT o.partner_slug) AS partners, MIN(o.price_pp) AS price_min, AVG(o.price_pp) AS price_avg, SUM(o.meal_type = 'all-inclusive') AS ai_offers FROM offers o INNER JOIN hotels h ON h.id = o.hotel_id WHERE o.active = 1 AND h.hidden = 0 AND o.price_pp > 0 AND ${where}`).bind(...p).first<any>();
    if (!base || !base.offers) return null;
    const nights = (await db.prepare(`SELECT o.nights AS n FROM offers o INNER JOIN hotels h ON h.id = o.hotel_id WHERE o.active = 1 AND h.hidden = 0 AND o.nights > 0 AND ${where} GROUP BY o.nights ORDER BY COUNT(*) DESC LIMIT 3`).bind(...p).all<any>()).results.map((r) => Number(r.n));
    const airports = (await db.prepare(`SELECT o.airport_slug AS slug, o.airport AS label, COUNT(*) AS cnt FROM offers o INNER JOIN hotels h ON h.id = o.hotel_id WHERE o.active = 1 AND h.hidden = 0 AND o.airport_slug <> '' AND ${where} GROUP BY o.airport_slug, o.airport ORDER BY cnt DESC LIMIT 3`).bind(...p).all<any>()).results;
    const month = await db.prepare(`SELECT strftime('%Y-%m', o.departure_date) AS ym, MIN(o.price_pp) AS mp FROM offers o INNER JOIN hotels h ON h.id = o.hotel_id WHERE o.active = 1 AND h.hidden = 0 AND o.price_pp > 0 AND o.departure_date >= ? AND ${where} GROUP BY ym HAVING COUNT(*) >= 5 ORDER BY mp ASC LIMIT 1`).bind(today(), ...p).first<any>();
    const n = Number(base.offers);
    return {
      hotels: Number(base.hotels), offers: n, partners: Number(base.partners), price_min: Number(base.price_min), price_avg: Math.round(Number(base.price_avg)),
      ai_share: n > 0 ? Math.round((100 * Number(base.ai_offers)) / n) : 0, nights, airports, month: month ? { ym: month.ym, mp: Number(month.mp) } : null,
    } satisfies Facts;
  });
}

const apLabels = (f: Facts) => f.airports.map((a) => String(a.label || a.slug));

export async function paragraph(db: D1Database, countrySlug: string, destSlug: string, label: string, range: Range = {}): Promise<string> {
  const f = await getFacts(db, countrySlug, destSlug, range);
  if (!f || f.offers < 5) return '';
  const s: string[] = [];
  s.push(`V katalogu máme ${nf(f.hotels)} ${countLabel(f.hotels, 'hotel', 'hotely', 'hotelů')} a ${nf(f.offers)} ${countLabel(f.offers, 'nabídku', 'nabídky', 'nabídek')} od ${f.partners} ${countLabel(f.partners, 'cestovní kanceláře', 'cestovních kanceláří', 'cestovních kanceláří')}.`);
  if (f.price_min > 0 && f.price_avg > 0) s.push(`Nejnižší cena je ${formatPrice(f.price_min)} za osobu, průměr napříč nabídkami vychází na ${formatPrice(f.price_avg)}.`);
  if (!range.date_from && !range.date_to && f.month && f.month.mp > 0) s.push(`Nejlevněji se teď odlétá v termínu ${monthLabel(f.month.ym, pragueNow().y)}, od ${formatPrice(f.month.mp)}.`);
  if (f.airports.length) { const ap = apLabels(f); s.push(ap.length > 1 ? `Létá se hlavně z těchto letišť: ${ap.join(', ')}.` : `Odlety jsou z letiště ${ap[0]}.`); }
  if (f.nights.length) s.push(`Nejčastější délka pobytu je ${f.nights.map(nightsLabel).join(', ')}.`);
  if (f.ai_share >= 10) s.push(`All inclusive je u ${f.ai_share} % nabídek.`);
  if (s.length < 3) return '';
  return `<h2>${esc(label)} v číslech</h2><p>${s.map(esc).join(' ')}</p><p class="text-sm">Čísla počítáme z vlastní databáze nabídek a aktualizujeme je několikrát denně.</p>`;
}

export async function faqs(db: D1Database, countrySlug: string, destSlug: string, label: string, range: Range = {}): Promise<Faq[]> {
  const f = await getFacts(db, countrySlug, destSlug, range);
  if (!f || f.offers < 5) return [];
  const out: Faq[] = [];
  if (f.price_min > 0) {
    let a = `Nejnižší cena v naší nabídce je ${formatPrice(f.price_min)} za osobu`;
    if (f.price_avg > 0) a += `, průměr napříč ${nf(f.offers)} nabídkami je ${formatPrice(f.price_avg)}`;
    out.push({ q: `Kolik stojí ${lower(label)}?`, a: a + '.' });
  }
  if (f.month && f.month.mp > 0) out.push({ q: 'Kdy je to nejlevnější?', a: `Z aktuálně dostupných termínů vychází nejlevněji ${monthLabel(f.month.ym, pragueNow().y)}, od ${formatPrice(f.month.mp)} za osobu. Ceny se mění denně, jak cestovky doplňují a ruší termíny.` });
  if (f.airports.length) { const ap = apLabels(f); out.push({ q: 'Odkud se létá?', a: ap.length > 1 ? `V nabídce jsou odlety z těchto letišť: ${ap.join(', ')}.` : `Odlety jsou z letiště ${ap[0]}.` }); }
  return out;
}

interface AnswerRow { slug: string; label: string; hotels: number; price_min: number; offers: number; ai_offers: number }
async function answerRows(db: D1Database, filters: { date_from?: string; date_to?: string; stay_night?: string; theme?: string }, limit = 12): Promise<AnswerRow[]> {
  const from = filters.date_from ?? ''; const to = filters.date_to ?? '';
  if (!from || !to) return [];
  const theme = filters.theme ?? ''; const night = /^\d{4}-\d{2}-\d{2}$/.test(filters.stay_night ?? '') ? filters.stay_night! : '';
  return remember(`danswer:${from}:${to}:${night}:${theme}:${limit}`, FACT_TTL_MS, async () => {
    const where = ['o.active = 1', 'h.hidden = 0', 'o.price_pp > 0', 'o.departure_date BETWEEN ? AND ?']; const params: unknown[] = [from, to];
    if (night) { where.push("o.departure_date <= ? AND date(o.departure_date, '+' || o.nights || ' days') > ?"); params.push(night, night); }
    if (theme) { const [s, p] = themeConditionSql(theme, 'h'); if (s) { where.push(s); params.push(...p); } }
    return (await db.prepare(`SELECT h.country_slug AS slug, h.country AS label, COUNT(DISTINCT h.id) AS hotels, MIN(o.price_pp) AS price_min, COUNT(*) AS offers, SUM(o.meal_type = 'all-inclusive') AS ai_offers FROM offers o INNER JOIN hotels h ON h.id = o.hotel_id WHERE ${where.join(' AND ')} GROUP BY h.country_slug, h.country HAVING hotels >= 3 ORDER BY hotels DESC LIMIT ${Math.trunc(limit)}`).bind(...params).all<AnswerRow>()).results;
  });
}

export async function destinationAnswer(db: D1Database, filters: { date_from?: string; date_to?: string; stay_night?: string; theme?: string }, whenLabel: string, limit = 12): Promise<string> {
  const rows = await answerRows(db, filters, limit);
  if (rows.length < 3) return '';
  const cheapest = rows.reduce((a, r) => (r.price_min < a.price_min ? r : a), rows[0]!);
  const lead = `Odjezdy i odlety v tomhle termínu má ${rows.length} ${countLabel(rows.length, 'země', 'země', 'zemí')}. Největší výběr je ${rows[0]!.label} — ${nf(rows[0]!.hotels)} ${countLabel(rows[0]!.hotels, 'hotel', 'hotely', 'hotelů')}. Nejnižší cena vychází na ${formatPrice(cheapest.price_min)} za osobu (${cheapest.label}).`;
  let out = `<h2>${esc(whenLabel)} — konkrétně</h2><p>${esc(lead)}</p><table><tbody><tr><th>Země</th><th>Hotelů</th><th>Cena od</th><th>All inclusive</th></tr>`;
  for (const r of rows) {
    const ai = Math.round((100 * r.ai_offers) / Math.max(1, r.offers));
    out += `<tr><td><a href="/${esc(r.slug)}/">${esc(r.label)}</a></td><td>${esc(nf(r.hotels))}</td><td>${esc(formatPrice(r.price_min))}</td><td>${esc(ai > 0 ? ai + ' % nabídek' : '—')}</td></tr>`;
  }
  return out + '</tbody></table><p class="text-sm">Pořadí i ceny počítáme z aktuálních nabídek českých cestovek a přepočítáváme několikrát denně.</p>';
}

export async function answerFaq(db: D1Database, filters: { date_from?: string; date_to?: string; stay_night?: string; theme?: string }, question: string, limit = 5): Promise<Faq[]> {
  const rows = await answerRows(db, filters, limit);
  if (rows.length < 3) return [];
  const parts = rows.map((r) => `${r.label} (od ${formatPrice(r.price_min)})`);
  const last = parts.pop();
  const a = `Podle aktuálních nabídek českých cestovek: ${parts.join(', ')} a ${last}. Největší výběr hotelů má ${rows[0]!.label}. Ceny jsou za osobu a mění se denně, jak cestovky doplňují termíny.`;
  return [{ q: question.replace(/\?+$/, '') + '?', a }];
}

export function destinationTable(reg: Registry, countrySlug: string, limit = 6): string {
  const dests = Object.entries(reg.destinations[countrySlug] ?? {}).sort((a, b) => b[1].cnt - a[1].cnt);
  if (!dests.length) return '';
  const cl = lower(regCountryLabel(reg, countrySlug));
  let rows = ''; let i = 0;
  for (const [slug, d] of dests) {
    const label = d.label || slug;
    if (slug === countrySlug || lower(label) === cl) continue;
    rows += `<tr><td><a href="/${esc(countrySlug)}/${esc(slug)}/">${esc(label)}</a></td><td>${esc(nf(d.cnt) + ' ' + countLabel(d.cnt, 'hotel', 'hotely', 'hotelů'))}</td><td>${d.min_price > 0 ? esc('od ' + formatPrice(d.min_price)) : '—'}</td></tr>`;
    if (++i >= limit) break;
  }
  return i === 0 ? '' : `<table><tbody><tr><th>Oblast</th><th>Hotelů</th><th>Cena od</th></tr>${rows}</tbody></table>`;
}
export { loadRegistry };
