/** Minimal SQL interface: D1 in the Worker, node:sqlite in tests. Statements are always parameterised. */
export type Param = string | number | null;
export interface Sql {
  all<T>(sql: string, params?: Param[]): Promise<T[]>;
  first<T>(sql: string, params?: Param[]): Promise<T | null>;
  run(sql: string, params?: Param[]): Promise<{ changes: number }>;
  batch(stmts: Array<{ sql: string; params?: Param[] }>): Promise<void>;
}

export function d1(db: D1Database): Sql {
  return {
    async all<T>(sql: string, params: Param[] = []) {
      return ((await db.prepare(sql).bind(...params).all<T>()).results ?? []) as T[];
    },
    async first<T>(sql: string, params: Param[] = []) {
      return ((await db.prepare(sql).bind(...params).all<T>()).results?.[0] ?? null) as T | null;
    },
    async run(sql: string, params: Param[] = []) {
      const r = await db.prepare(sql).bind(...params).run();
      return { changes: r.meta?.changes ?? 0 };
    },
    async batch(stmts) {
      if (stmts.length) await db.batch(stmts.map((s) => db.prepare(s.sql).bind(...(s.params ?? []))));
    },
  };
}
