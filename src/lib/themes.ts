// Keyword themes (ported from Kakapo_Search_Engine::theme_condition_sql). Evaluated once per hotel at import time and stored
// in hotels.theme_flags, so listing queries compare an integer instead of scanning description texts.
export const THEME_BITS: Record<string, number> = { children: 1, aquapark: 2, 'sandy-beach': 4 };

export const THEME_KEYWORDS = {
  children: ['děti', 'deti', 'dětmi', 'detmi', 'dítě', 'dite', 'dětsk', 'detsk', 'rodin', 'family', 'child', 'children', 'kids', 'baby', 'aquapark', 'aqua park', 'tobog', 'skluzav', 'miniklub', 'mini klub', 'hřišt', 'hrist', 'animac', 'dětský klub', 'detsky klub'],
  aquapark: ['aquapark', 'aqua park', 'water park', 'vodní park', 'vodni park', 'tobog', 'skluzav', 'skluzavka', 'skluzavky', 'water slide', 'bazénový komplex', 'bazenovy komplex'],
  'sandy-beach': ['píseč', 'pisec', 'písčit', 'piscit', 'písek', 'pisek', 'sandy', 'sand beach', 'pláž s jemným pískem', 'plaz s jemnym piskem', 'pozvolný vstup', 'pozvolny vstup'],
} as const;
/** Which hotel columns each theme looks at (the PHP used name+description+amenities, sandy-beach only description+amenities). */
const COLUMNS: Record<string, Array<'name' | 'description' | 'amenities'>> = { children: ['name', 'description', 'amenities'], aquapark: ['name', 'description', 'amenities'], 'sandy-beach': ['description', 'amenities'] };

export interface ThemeInput { name?: string | null; description?: string | null; amenities?: string | null; offerTexts?: Array<string | null | undefined> }

export function computeThemeFlags(h: ThemeInput): number {
  const cols = { name: (h.name ?? '').toLowerCase(), description: (h.description ?? '').toLowerCase(), amenities: (h.amenities ?? '').toLowerCase() };
  const offers = (h.offerTexts ?? []).map((t) => (t ?? '').toLowerCase()).filter(Boolean);
  let flags = 0;
  for (const [theme, kws] of Object.entries(THEME_KEYWORDS)) {
    const hay = [...COLUMNS[theme]!.map((c) => cols[c]), ...offers];
    if (kws.some((kw) => hay.some((t) => t.includes(kw)))) flags |= THEME_BITS[theme]!;
  }
  return flags;
}
