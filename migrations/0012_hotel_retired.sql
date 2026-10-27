-- Hotels without any offer for HOTEL_RETIRE_DAYS are retired: a 301 row in `redirects` (reason 'retired') sends the URL to the
-- most relevant live category, the hotel row stays (it keeps its slug and dedup_key, so a returning hotel is reactivated, not duplicated).
ALTER TABLE hotels ADD COLUMN retired_at TEXT;
CREATE INDEX IF NOT EXISTS idx_hotels_retired ON hotels(retired_at) WHERE retired_at IS NOT NULL;
