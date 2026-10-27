/**
 * One-off (idempotent) geo clean-up of EXISTING hotels, the same rules the importer now applies to new ones
 * (workers/import/src/util/country.ts): one spelling per country, a country for hotels whose feed had none.
 * The slug stays (URLs do not change); the dedup_key is recomputed so the next import matches the row instead of creating a duplicate.
 *
 *   tsx scripts/normalize-geo.ts            # report only
 *   tsx scripts/normalize-geo.ts --apply    # write (production D1 through the Cloudflare API)
 */
import { readFileSync } from 'node:fs';
import { resolveCountry } from '../workers/import/src/util/country';
import { hotelDedupKey, slugify } from '../workers/import/src/util/text';

const env = (f: string) => Object.fromEntries(readFileSync(`/home/kenny/ai/credentials/${f}`, 'utf8').split('\n').map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m![1], m![2]!.replace(/^["']|["']$/g, '')]));
const cf = env('.cloudflare-credentials.env'); const kk = env('.kakapo-credentials.env');
const apply = process.argv.includes('--apply');
const DB = '302b7cb9-53f0-47f3-bb6a-239a7402334f';
const url = `https://api.cloudflare.com/client/v4/accounts/${kk.CF_ACCOUNT_ID}/d1/database/${DB}/query`;
const headers = { 'X-Auth-Email': (cf.CF_EMAIL || kk.CF_AUTH_EMAIL)!, 'X-Auth-Key': (cf.CF_GLOBAL_API_KEY || kk.CF_GLOBAL_API_KEY)!, 'Content-Type': 'application/json' };
async function q(body: unknown): Promise<Array<{ results: Array<Record<string, unknown>> }>> {
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(Array.isArray(body) ? { batch: body } : body) });
  const j = (await r.json()) as { success: boolean; result: Array<{ results: Array<Record<string, unknown>> }>; errors?: unknown };
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result;
}

interface H { id: number; slug: string; dedup_key: string; name: string; country: string; destination: string; city: string; lat: number | null; lng: number | null }
const rows: H[] = [];
for (let off = 0; ; off += 5000) {
  const part = (await q({ sql: 'SELECT id, slug, dedup_key, name, country, destination, city, lat, lng FROM hotels ORDER BY id LIMIT 5000 OFFSET ?', params: [off] }))[0]!.results as unknown as H[];
  rows.push(...part); if (part.length < 5000) break;
}
const keys = new Set(rows.map((r) => r.dedup_key));
const changes: Array<{ h: H; country: string; key: string }> = []; const conflicts: Array<{ h: H; country: string; key: string }> = [];
const tally = new Map<string, number>();
for (const h of rows) {
  const country = resolveCountry(h.country, h.destination);
  if (country === '' || country === h.country) continue;
  const key = hotelDedupKey(country, h.city, h.destination, h.name, h.lat, h.lng);
  (keys.has(key) && key !== h.dedup_key ? conflicts : changes).push({ h, country, key });
  const t = `${h.country || '(none)'} → ${country}`; tally.set(t, (tally.get(t) ?? 0) + 1);
}
console.log(`${rows.length} hotels, ${changes.length} to relabel, ${conflicts.length} skipped (the normalised key already belongs to another hotel)`);
for (const [t, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), t);
if (!apply) process.exit(0);
for (let i = 0; i < changes.length; i += 40) {
  await q(changes.slice(i, i + 40).map(({ h, country, key }) => ({ sql: 'UPDATE hotels SET country = ?, country_slug = ?, dedup_key = ? WHERE id = ?', params: [country, slugify(country), key, h.id] })));
}
// rebuild the registry/snapshots/sitemap with the next import tick
await q({ sql: "UPDATE site_cache SET value = '1' WHERE key = 'snapshots_dirty'", params: [] });
await q({ sql: "UPDATE site_cache SET updated_at = '2000-01-01T00:00:00.000Z' WHERE key IN ('registry', 'sitemap:index')", params: [] });
console.log('applied', changes.length);
