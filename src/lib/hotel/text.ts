import { esc } from '../helpers';
/** Minimal wpautop for plain-text FAQ answers: escape, paragraphs on blank lines, <br> on single newlines. */
export function autop(text: string): string {
  return String(text ?? '').trim().split(/\n\s*\n/).map((p) => '<p>' + esc(p.trim()).replace(/\n/g, '<br />\n') + '</p>').join('\n');
}
