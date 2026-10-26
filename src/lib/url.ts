// Content from the WordPress data dumps carries absolute https://kakapo.cz URLs; render them host-relative
// so staging/preview hosts stay self-contained. Canonical/og URLs still use siteUrl().
export const rel = (u: string): string => String(u ?? '').replace(/^https?:\/\/(www\.)?kakapo\.cz(?=\/|$)/i, '') || '/';
export const relHtml = (html: string): string => String(html ?? '').replace(/(href|src)=(["'])https?:\/\/(www\.)?kakapo\.cz(\/[^"']*)?\2/gi, (_m, a, q, _w, p) => `${a}=${q}${p ?? '/'}${q}`);
