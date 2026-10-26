-- Precomputed snapshots (registry of countries/destinations/airports/partners, global facets, sitemap parts).
-- Written by the import Worker after each run (src/lib/snapshots.ts), read by the web Worker.
CREATE TABLE site_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT, WITHOUT ROWID;
