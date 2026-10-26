// Static product taxonomy (dumped from Kakapo_Product_Categories / Kakapo_Product_Landings).
import categoriesJson from '../../data/product-categories.json';
import landingsJson from '../../data/product-landings.json';
import { relHtml, rel } from '../url';

export interface Faq { q: string; a: string }
export interface Category { label: string; path: string; photo: string; intro: string; seo_text?: string; faqs?: Faq[] }
export interface Landing {
  label: string; path: string; type: string; filters?: Record<string, string | number>; title?: string; description?: string;
  intro: string; seo_text?: string; faqs?: Faq[]; index_min?: number;
}
export const CATEGORIES = categoriesJson as unknown as Record<string, Category>;
export const LANDINGS = landingsJson as unknown as Record<string, Landing>;

export const categoryExists = (t: string) => Object.prototype.hasOwnProperty.call(CATEGORIES, t);
export const getCategory = (t: string): Category => CATEGORIES[t] ?? CATEGORIES.zajezdy!;
export const typeFromPath = (p: string): string => Object.entries(CATEGORIES).find(([, c]) => c.path === p)?.[0] ?? '';
export const getLanding = (slug: string): Landing | null => (Object.prototype.hasOwnProperty.call(LANDINGS, slug) ? LANDINGS[slug]! : null);
export const categoryLabel = (t: string) => getCategory(t).label;
export const categoryPath = (t: string) => getCategory(t).path;
/** Photo path of the category (host-relative). */
export const categoryPhoto = (t: string) => rel(getCategory(t).photo);
export const fixHtml = (h: string | undefined) => relHtml(h ?? '');

const ICONS: Record<string, string> = {
  poznavaci: '<circle cx="12" cy="12" r="9"/><path d="M2 12h20M12 3c2.5 2.5 3.5 6 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-6-3.5-9s1-6.5 3.5-9z"/>',
  vzdelavaci: '<path d="M4 19.5V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-1.5zM8 7h6M8 11h7M8 15h5"/>',
  zazitky: '<path d="M12 21s-7-4.3-9.3-8.4C1.2 9.9 2.6 6.5 6 6.5c2 0 3.2 1.2 4 2.5.8-1.3 2-2.5 4-2.5 3.4 0 4.8 3.4 3.3 6.1C19 16.7 12 21 12 21z"/>',
  wellness: '<path d="M12 21c4-2 7-5.2 7-9.3 0-1.9-1-3.2-2.6-3.2-1.1 0-2 .7-2.4 2 0-3-1-5-2-6-1 1-2 3-2 6-.4-1.3-1.3-2-2.4-2C5 8.5 4 9.8 4 11.7 4 15.8 8 19 12 21z"/>',
  plavby: '<path d="M3 15l1.5 5h15L21 15M5 15V8l7-3 7 3v7M12 3v2M4 15c1.2.6 1.8 1 3 1s1.8-.4 3-1 1.8-1 3-1 1.8.4 3 1 1.8 1 3 1"/>',
  eurovikendy: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4M9 11h.01M15 11h.01M12 11h.01"/>',
  lyzovani: '<path d="M3 20l16-6M5 18l1-2M8 3l6 12M8 3l-1 4 3 2M19 21a2 2 0 0 0 0-4"/>',
  zajezdy: '<path d="M2 18h20M4 18c0-3 3.5-5 8-5s8 2 8 5M12 13V6M12 6c2 0 4 1 4 3-2.7 0-4-1-4-3zM12 6c-2 0-4 1-4 3 2.7 0 4-1 4-3z"/>',
};
export function categoryIcon(type: string): string {
  return `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[type] ?? ICONS.zajezdy}</svg>`;
}
