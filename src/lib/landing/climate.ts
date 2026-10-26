// Port of Kakapo_Climate::section() — weather and sea temperature table for selected destinations.
import klima from '../../data/klima.json';
import { esc } from './util';

const PATHS: Record<string, string> = {
  '/kypr/': 'kypr', '/portugalsko/madeira/': 'madeira', '/spojene-arabske-emiraty/dubaj/': 'dubaj', '/kapverdy/': 'kapverdy', '/zanzibar/': 'zanzibar',
  '/maledivy/': 'maledivy', '/spanelsko/gran-canaria/': 'grancanaria', '/kanarske-ostrovy/gran-canaria/': 'grancanaria', '/spanelsko/tenerife/': 'tenerife',
  '/kanarske-ostrovy/tenerife/': 'tenerife', '/thajsko/phuket/': 'phuket', '/thajsko/koh-samui/': 'samui', '/thajsko/bangkok/': 'bangkok', '/egypt/hurghada/': 'hurghada',
};
const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
const GEN = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];
const LOC = ['v lednu', 'v únoru', 'v březnu', 'v dubnu', 'v květnu', 'v červnu', 'v červenci', 'v srpnu', 'v září', 'v říjnu', 'v listopadu', 'v prosinci'];

// PHP round() is half away from zero at 1 decimal; JS toFixed differs on binary edge cases, so round via scaling.
const t = (v: number): string => String(Math.round((v + Number.EPSILON) * 10) / 10).replace('.', ',');
const ext = (a: number[], max: boolean): number => { const b = max ? Math.max(...a) : Math.min(...a); return a.indexOf(b); };

function rangeLabel(idx: number[]): string {
  idx = [...idx].sort((a, b) => a - b); const n = idx.length;
  if (n === 12) return 'celý rok';
  if (n === 1) return LOC[idx[0]!]!;
  const set = new Set(idx);
  for (const start of idx) {
    if (set.has((start + 11) % 12)) continue;
    let len = 1; while (set.has((start + len) % 12)) len++;
    if (len === n) return `od ${GEN[start]} do ${GEN[(start + n - 1) % 12]}`;
    break;
  }
  return 'v měsících ' + idx.map((i) => MONTHS[i]).join(', ');
}

export function climateSection(path: string): string {
  const key = PATHS[path]; const all = klima as Record<string, any>;
  if (!key || !all[key]) return '';
  const d = all[key]; const hi: number[] = d.high; const lo: number[] = d.low; const rain: number[] | null = d.rain_days ?? null; const sea: number[] | null = d.sea ?? null;
  const s: string[] = [];
  const warm = ext(hi, true), cold = ext(hi, false);
  s.push(`Nejtepleji bývá ${LOC[warm]} (přes den průměrně ${t(hi[warm]!)} °C), nejchladněji ${LOC[cold]} (${t(hi[cold]!)} °C přes den, ${t(lo[cold]!)} °C v noci).`);
  if (rain && Math.max(...rain) >= 1.5) { const wet = ext(rain, true); s.push(`Nejvíc deštivých dní bývá ${LOC[wet]} (v průměru ${t(rain[wet]!)}).`); }
  else if (rain) s.push(`Srážek je minimum: ani v nejdeštivějším měsíci nevychází v průměru víc než ${t(Math.max(...rain))} deštivého dne.`);
  if (sea) {
    const ok = sea.map((v, i) => (v >= 24 ? i : -1)).filter((i) => i >= 0);
    if (ok.length) s.push(`Moře má nejméně 24 °C ${rangeLabel(ok)}; nejteplejší je ${LOC[ext(sea, true)]} (${t(Math.max(...sea))} °C).`);
    else s.push(`Moře nepřekročí ${t(Math.max(...sea))} °C (nejteplejší ${LOC[ext(sea, true)]}), takže koupání je spíš krátké osvěžení než plavání.`);
    const swim = hi.map((v, i) => (v >= 26 && v <= 36 && sea[i]! >= 22 && (!rain || rain[i]! <= 6) ? i : -1)).filter((i) => i >= 0);
    if (swim.length) s.push(`Pro koupání, tedy přes den 26 až 36 °C, moře aspoň 22 °C, nejvýš 36 °C a málo deštivých dní, vycházejí podle těchto dat měsíce: ${swim.map((i) => MONTHS[i]).join(', ')}.`);
  }
  let html = `<h2>Kdy jet: počasí a teplota moře — ${esc(d.label)}</h2><p>${esc(s.join(' '))}</p>`;
  const head = ['Měsíc', 'Přes den', 'V noci']; if (rain) head.push('Deštivé dny'); if (sea) head.push('Moře');
  html += '<div class="table-scroll"><table class="clim"><thead><tr>' + head.map((h) => `<th>${esc(h)}</th>`).join('') + '</tr></thead><tbody>';
  for (let i = 0; i < 12; i++) {
    const m = MONTHS[i]!; html += `<tr><td>${esc(m.charAt(0).toUpperCase() + m.slice(1))}</td><td>${esc(t(hi[i]!))} °C</td><td>${esc(t(lo[i]!))} °C</td>`;
    if (rain) html += `<td>${esc(t(rain[i]!))}</td>`;
    if (sea) html += `<td>${esc(t(sea[i]!))} °C</td>`;
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  html += `<p class="text-sm">Zdroj: klimatické normály, stanice ${esc(d.station)}${d.sea_note ? '; teplota moře: ' + esc(d.sea_note) : ''}. Jde o dlouhodobé průměry, konkrétní týden se může lišit.</p>`;
  return html;
}
