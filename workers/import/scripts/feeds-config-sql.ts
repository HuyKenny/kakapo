// Emits SQL that copies the declarative feed configuration (mapping JSON, preset, source kind) from the WordPress export
// into the feeds table created by migrate-from-wp.ts. Feed URLs are NOT in the export; set them as Worker secrets:
//   wrangler secret put FEED_URL_<id> -c workers/import/wrangler.jsonc --env <env>
// Usage: tsx workers/import/scripts/feeds-config-sql.ts <export-dir> > feeds-config.sql
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: feeds-config-sql.ts <export-dir>');
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
const lines = readFileSync(join(dir, 'feeds.ndjson'), 'utf8').split('\n').filter(Boolean);
const secrets: string[] = [];
for (const l of lines) {
  const f = JSON.parse(l) as { id: string; partner_slug: string; source_type: string; content_type: string; format_preset: string; mapping: string | null; enabled: string };
  const mapping = f.mapping && f.mapping !== '' ? f.mapping : '{}';
  JSON.parse(mapping); // fail loudly on a corrupt mapping
  const kind = f.source_type === 'cj' ? 'cj' : f.partner_slug === 'cedok' ? 'r2' : 'http';
  console.log(`UPDATE feeds SET mapping_json = ${q(mapping)}, format_preset = ${q(f.format_preset)}, source_kind = ${q(kind)} WHERE id = ${Number(f.id)};`);
  if (kind === 'http') secrets.push(`FEED_URL_${f.id}`);
}
console.error(`# secrets to set (${secrets.length}): ${secrets.join(' ')}`);
