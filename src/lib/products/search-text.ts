// Folding used for product search: the D1 trigger (migration 0006) stores search_text folded the same way.
export function foldText(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l');
}
export const likeEscape = (s: string): string => s.replace(/[\\%_]/g, '\\$&');
