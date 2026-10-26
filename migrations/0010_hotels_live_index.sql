-- Listings/counts always filter offers_active > 0 AND hidden = 0; a partial index keeps those scans to live hotels only.
CREATE INDEX IF NOT EXISTS idx_hotels_live ON hotels(country_slug, min_price) WHERE offers_active > 0 AND hidden = 0;
