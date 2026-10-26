// The shared libraries in src/lib (snapshots, sitemap) are typed against Cloudflare's D1 types; the import Worker has its own
// structural D1 interfaces (deps.ts), so alias the globals to them for type checking here.
import type { D1Stmt, Db } from './deps';
declare global {
  type D1Database = Db;
  type D1PreparedStatement = D1Stmt;
}
