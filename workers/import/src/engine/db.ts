import type { Db, D1Stmt } from '../deps';

/** D1 allows 100 bound parameters per statement; stay below it. */
export const MAX_PARAMS = 80;
export const chunk = <T>(a: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
export const qs = (n: number) => Array(n).fill('?').join(',');

export async function selectIn<T = Record<string, unknown>>(db: Db, sql: string, values: unknown[], pre: unknown[] = []): Promise<T[]> {
  // sql contains the placeholder token {IN}
  const out: T[] = [];
  for (const part of chunk(values, MAX_PARAMS - pre.length)) {
    const r = await db.prepare(sql.replace('{IN}', qs(part.length))).bind(...pre, ...part).all<T>();
    out.push(...r.results);
  }
  return out;
}

/** Statements per db.batch call (one transaction); keeps request size and CPU per call bounded. */
export const BATCH_SIZE = 50;
export async function runBatches(db: Db, stmts: D1Stmt[]): Promise<number> {
  let changes = 0;
  for (const part of chunk(stmts, BATCH_SIZE)) {
    const rs = await db.batch(part);
    for (const r of rs) changes += r.meta.changes ?? 0;
  }
  return changes;
}

export const parseJson = <T>(s: unknown, fallback: T): T => { try { const v = JSON.parse(String(s ?? '')); return v ?? fallback; } catch { return fallback; } };
