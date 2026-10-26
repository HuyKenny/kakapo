// node:sqlite as a D1 stand-in (D1Database subset used by src/lib/landing, search.ts and snapshots.ts).
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, existsSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '../..');
const MIGRATIONS = join(ROOT, 'migrations');

class Stmt {
  constructor(private raw: DatabaseSync, public sql: string, private params: unknown[] = []) {}
  bind(...v: unknown[]) { return new Stmt(this.raw, this.sql, v.map((x) => (x === undefined ? null : x))); }
  async all<T = any>() { return { results: this.raw.prepare(this.sql).all(...(this.params as never[])) as T[], meta: {} }; }
  async first<T = any>() { return (this.raw.prepare(this.sql).get(...(this.params as never[])) as T | undefined) ?? null; }
  async run() { const r = this.raw.prepare(this.sql).run(...(this.params as never[])); return { results: [], meta: { changes: Number(r.changes) } }; }
}

export function wrap(raw: DatabaseSync): D1Database {
  const db = {
    prepare: (sql: string) => new Stmt(raw, sql),
    async batch(stmts: Stmt[]) { raw.exec('BEGIN'); try { const out = []; for (const s of stmts) out.push(await s.run()); raw.exec('COMMIT'); return out; } catch (e) { raw.exec('ROLLBACK'); throw e; } },
  };
  return db as unknown as D1Database;
}

export function migrate(raw: DatabaseSync): void {
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
}

export function memoryDb(): { raw: DatabaseSync; db: D1Database } {
  const raw = new DatabaseSync(':memory:'); migrate(raw);
  return { raw, db: wrap(raw) };
}

/** Real catalogue from backups/kakapo-wp-export-* (without price_history) in a SQLite file; built once. */
export function exportDb(): { raw: DatabaseSync; db: D1Database } | null {
  const exportDir = process.env.KAKAPO_EXPORT_DIR ?? '/home/kenny/ai/backups/kakapo-wp-export-2026-10-26';
  if (!existsSync(exportDir)) return null;
  const file = '/tmp/kakapo-landing-oracle.sqlite3';
  if (!existsSync(file)) {
    const src = '/tmp/kakapo-landing-export-src'; const sql = '/tmp/kakapo-landing-sql';
    rmSync(src, { recursive: true, force: true }); rmSync(sql, { recursive: true, force: true }); mkdirSync(src, { recursive: true });
    for (const n of ['hotels.ndjson', 'offers.ndjson', 'feeds.ndjson', 'products.ndjson', 'hotel_aliases.ndjson', 'landing_texts.json']) if (existsSync(join(exportDir, n))) symlinkSync(join(exportDir, n), join(src, n));
    execFileSync('npx', ['tsx', join(ROOT, 'scripts/migrate-from-wp.ts'), src, sql], { cwd: ROOT, stdio: 'ignore' });
    const raw = new DatabaseSync(file); raw.exec('PRAGMA foreign_keys = OFF'); migrate(raw);
    for (const f of readdirSync(sql).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(join(sql, f), 'utf8'));
    raw.close();
  }
  const raw = new DatabaseSync(file);
  return { raw, db: wrap(raw) };
}
