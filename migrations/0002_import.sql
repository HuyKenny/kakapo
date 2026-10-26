-- Import Worker additions (see docs/FEED-IMPORTS.md).
-- feeds: declarative XML mapping / CJ config copied from the WP export (no URLs, no tokens), source kind, run bookkeeping.
ALTER TABLE feeds ADD COLUMN mapping_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE feeds ADD COLUMN format_preset TEXT NOT NULL DEFAULT '';
ALTER TABLE feeds ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'http' CHECK (source_kind IN ('http','cj','r2'));
ALTER TABLE feeds ADD COLUMN current_run INTEGER;            -- run owning the lock, NULL when idle
ALTER TABLE feeds ADD COLUMN paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0,1));
ALTER TABLE feeds ADD COLUMN force_run INTEGER NOT NULL DEFAULT 0 CHECK (force_run IN (0,1));  -- manual "run now" ignores the night window

-- A partner can publish one offer through several feeds (Invia country feeds); the importer looks it up by (partner, external_id).
CREATE INDEX idx_offers_partner_ext ON offers(partner_slug, external_id);
-- Slug lookups while inserting hotels/products are covered by the UNIQUE constraints.
-- Daily job helpers.
CREATE INDEX idx_offers_inactive_seen ON offers(last_seen) WHERE active = 0;
CREATE INDEX idx_offers_departure ON offers(departure_date) WHERE active = 1;
