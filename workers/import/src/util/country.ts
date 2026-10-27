// Country names must be ONE spelling per country, otherwise a country is split into several category pages
// (/cesko/ vs /ceska-republika/, /kambodza/ vs /kambozda/ …) and each one is thin. Feeds spell countries differently
// (with/without diacritics, typos, regions as countries), so every country goes through canonicalCountry() before it is stored.
import { slugify } from './text';

/** ISO 3166 alpha-3 (Čedok `country_id`) → Czech name. Names equal the labels the other feeds already use, so the slugs coincide. */
export const ISO3: Record<string, string> = {
  CZE: 'Česko', SVK: 'Slovensko', ITA: 'Itálie', ESP: 'Španělsko', GRC: 'Řecko', TUR: 'Turecko', EGY: 'Egypt', HRV: 'Chorvatsko', CYP: 'Kypr', MLT: 'Malta',
  TUN: 'Tunisko', MAR: 'Maroko', PRT: 'Portugalsko', FRA: 'Francie', AUT: 'Rakousko', DEU: 'Německo', CHE: 'Švýcarsko', HUN: 'Maďarsko', POL: 'Polsko',
  SVN: 'Slovinsko', ALB: 'Albánie', MNE: 'Černá Hora', BGR: 'Bulharsko', GBR: 'Velká Británie', NLD: 'Nizozemsko', BEL: 'Belgie', IRL: 'Irsko', ISL: 'Island',
  NOR: 'Norsko', SWE: 'Švédsko', FIN: 'Finsko', DNK: 'Dánsko', ARE: 'Spojené arabské emiráty', OMN: 'Omán', JOR: 'Jordánsko', ISR: 'Izrael', SAU: 'Saúdská Arábie',
  GEO: 'Gruzie', ARM: 'Arménie', UZB: 'Uzbekistán', KAZ: 'Kazachstán', THA: 'Thajsko', VNM: 'Vietnam', IDN: 'Indonésie', LKA: 'Srí Lanka', MDV: 'Maledivy',
  MUS: 'Mauricius', SYC: 'Seychely', TZA: 'Tanzánie', KEN: 'Keňa', ZAF: 'JAR', USA: 'USA', MEX: 'Mexiko', CUB: 'Kuba', DOM: 'Dominikánská republika',
  BRA: 'Brazílie', CHN: 'Čína', JPN: 'Japonsko', IND: 'Indie', MMR: 'Myanmar',
  // added 27. 10. 2026: codes the Čedok feed sends that used to map to '' (hotels without a country → //slug/ 404 pages in the sitemap)
  LVA: 'Lotyšsko', LTU: 'Litva', EST: 'Estonsko', QAT: 'Katar', BHR: 'Bahrajn', KWT: 'Kuvajt', MYS: 'Malajsie', SGP: 'Singapur', PHL: 'Filipíny', KHM: 'Kambodža',
  LAO: 'Laos', KOR: 'Jižní Korea', TWN: 'Tchaj-wan', GMB: 'Gambie', SEN: 'Senegal', CPV: 'Kapverdy', BIH: 'Bosna a Hercegovina', SRB: 'Srbsko', MKD: 'Severní Makedonie',
  ROU: 'Rumunsko', AZE: 'Ázerbájdžán', JAM: 'Jamajka', BRB: 'Barbados', ABW: 'Aruba', CUW: 'Curaçao', ATG: 'Antigua a Barbuda', MAF: 'Svatý Martin', CAN: 'Kanada',
  CRI: 'Kostarika', PAN: 'Panama', COL: 'Kolumbie', PER: 'Peru', ARG: 'Argentina', CHL: 'Chile', AUS: 'Austrálie', NZL: 'Nový Zéland', LUX: 'Lucembursko',
  AND: 'Andorra', MCO: 'Monako', LIE: 'Lichtenštejnsko', UKR: 'Ukrajina', RUS: 'Rusko', BLR: 'Bělorusko', MDA: 'Moldavsko', XKX: 'Kosovo', NAM: 'Namibie',
  UGA: 'Uganda', ETH: 'Etiopie', GHA: 'Ghana', MDG: 'Madagaskar', RWA: 'Rwanda', ZMB: 'Zambie', ZWE: 'Zimbabwe', BWA: 'Botswana', NPL: 'Nepál', BTN: 'Bhútán',
  BGD: 'Bangladéš', PAK: 'Pákistán', IRN: 'Írán', IRQ: 'Irák', LBN: 'Libanon', TJK: 'Tádžikistán', KGZ: 'Kyrgyzstán', MNG: 'Mongolsko', BRN: 'Brunej', ISR_: 'Izrael',
};
delete (ISO3 as Record<string, string>).ISR_;

/** Canonical Czech name by the slug of the spelling a feed delivered. Anything not listed keeps its own spelling. */
const CANON_BY_SLUG: Record<string, string> = {
  'ceska-republika': 'Česko', cr: 'Česko', 'kapverdske-ostrovy': 'Kapverdy', kambozda: 'Kambodža', kambodza: 'Kambodža', 'velka-britanie': 'Velká Británie',
  cina: 'Čína', svedsko: 'Švédsko', svycarsko: 'Švýcarsko', dansko: 'Dánsko', lotyssko: 'Lotyšsko', bahrain: 'Bahrajn', usa: 'USA', 'jizni-korea': 'Jižní Korea',
  brazilie: 'Brazílie', 'novy-zeland': 'Nový Zéland', 'saudska-arabie': 'Saúdská Arábie', 'stredoafricka-republika': 'Středoafrická republika',
  'indonesie-bali-lombok-sulawesi': 'Indonésie', 'spojene-staty-americke': 'USA',
};

export function canonicalCountry(name: unknown): string {
  const n = String(name ?? '').trim();
  return CANON_BY_SLUG[slugify(n)] ?? n;
}

/** Hotels whose feed gives no country but a well-known destination (Čedok ski areas, Baltic and Balkan cities). */
const DEST_COUNTRY: Record<string, string> = {
  'jizni-tyrolsko': 'Itálie', 'val-di-sole': 'Itálie', 'sella-ronda': 'Itálie', 'via-lattea-sestriere': 'Itálie', livigno: 'Itálie', 'monte-bondone': 'Itálie',
  'ponte-di-legno-tonale': 'Itálie', 'val-di-fiemme-obereggen': 'Itálie', aprica: 'Itálie', bormio: 'Itálie', 'alpe-lusia-san-pellegrino': 'Itálie',
  'san-martino-di-castrozza-passo-rolle': 'Itálie', 'cortina-d-ampezzo': 'Itálie', 'cortina-dampezzo': 'Itálie', 'paganella-ski': 'Itálie', 'folgaria-lavarone': 'Itálie',
  riga: 'Lotyšsko', vilnius: 'Litva', doha: 'Katar', langkawi: 'Malajsie', 'kuala-lumpur': 'Malajsie', serekunda: 'Gambie', belehrad: 'Srbsko', mostar: 'Bosna a Hercegovina',
  'sarajevo-a-okoli': 'Bosna a Hercegovina', neum: 'Bosna a Hercegovina', shahdag: 'Ázerbájdžán', bukurest: 'Rumunsko',
};

/** Placeholders feeds send instead of a country (Fischer/Exim: "Destinace" with the real country in `destination`). */
const NOT_A_COUNTRY = new Set(['destinace']);
const KNOWN_COUNTRIES = new Map(Object.values(ISO3).map((n) => [slugify(n), n]));

export function resolveCountry(country: unknown, destination: unknown): string {
  const c = NOT_A_COUNTRY.has(slugify(country)) ? '' : canonicalCountry(country);
  if (c !== '') return c;
  const d = slugify(destination);
  return DEST_COUNTRY[d] ?? KNOWN_COUNTRIES.get(d) ?? '';
}
