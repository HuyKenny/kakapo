// Runtime dependencies behind small interfaces: production uses D1/R2/fetch, tests use node:sqlite and in-memory maps.
export interface D1Result<T = unknown> { results: T[]; success?: boolean; meta: { changes?: number; last_row_id?: number; rows_read?: number; rows_written?: number } }
export interface D1Stmt {
  bind(...v: unknown[]): D1Stmt;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;
}
export interface Db { prepare(sql: string): D1Stmt; batch(stmts: D1Stmt[]): Promise<D1Result[]> }

export interface R2Obj { key: string; size: number; etag: string; uploaded: Date; body: ReadableStream<Uint8Array>; text(): Promise<string> }
export interface R2Like {
  get(key: string): Promise<R2Obj | null>;
  put(key: string, value: string | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>, opts?: { httpMetadata?: { contentType?: string } }): Promise<{ etag?: string } | null>;
  list(opts: { prefix: string; cursor?: string; limit?: number }): Promise<{ objects: Array<{ key: string; uploaded: Date; size: number }>; truncated: boolean; cursor?: string }>;
  delete(keys: string | string[]): Promise<void>;
}

export interface ImportEnv {
  DB: Db;
  SNAPSHOTS: R2Like;
  IMPORT_SHARED_SECRET?: string;
  ALLOWED_FEED_HOSTS?: string;   // comma separated: exact hosts or *.suffix
  IMPORT_WINDOW?: string;        // "0-7" Prague hours, "" or equal numbers = always open
  CJ_API_TOKEN?: string;
  CJ_CID?: string;
  CJ_PID?: string;
  SITE_URL?: string;             // base for the sitemaps rebuilt after imports
  MAX_DROP_PCT?: string;         // size guard, default 40
  LAST_MINUTE_DAYS?: string;
  FIRST_MINUTE_DAYS?: string;
  WARM_ENABLED?: string;         // '0' = the tick does not pre-warm wsrv.nl images
  [key: `FEED_URL_${number}`]: string | undefined;
}

export interface Deps {
  env: ImportEnv;
  now(): Date;
  fetch: typeof fetch;
  sleep(ms: number): Promise<void>;
  /** wall-clock budget for one invocation (ms); engine stops between blocks when exceeded */
  budgetMs: number;
  log(event: string, data?: Record<string, unknown>): void;
  /** overridable in tests; production uses src/lib/snapshots.ts and src/lib/sitemap.ts */
  hooks?: { rebuildSnapshots?: (db: Db, now: string) => Promise<unknown>; rebuildSitemaps?: (db: Db, base: string) => Promise<unknown> };
}
