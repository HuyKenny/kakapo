-- Kakapo catalogue on D1 (SQLite). Mapped from the WordPress tables wp_kakapo_* (see docs/DATA-MAPPING.md).
-- Conventions: dates are ISO text (UTC), money is an INTEGER in whole currency units (the feeds deliver whole CZK;
-- no floats anywhere), booleans are 0/1 with CHECKs, WordPress ids are kept in `wp_id` for the migration map.

CREATE TABLE partners (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  disclosure TEXT NOT NULL DEFAULT '',          -- text next to sponsored links
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1))
) STRICT;

CREATE TABLE feeds (
  id INTEGER PRIMARY KEY,                        -- same id as wp_kakapo_feeds.id
  name TEXT NOT NULL,
  partner_slug TEXT NOT NULL REFERENCES partners(slug),
  adapter TEXT NOT NULL,                         -- cj-atcom | cj-bluestyle | cj-tui | xml-invia | xml-slevomat | cedok-slim | ...
  content_type TEXT NOT NULL CHECK (content_type IN ('hotels','products')),
  is_full_catalogue INTEGER NOT NULL DEFAULT 1 CHECK (is_full_catalogue IN (0,1)), -- 0 = incremental, absence never deactivates
  source_ref TEXT NOT NULL,                      -- name of the secret holding the URL; the URL itself is never stored here
  affiliate_params TEXT NOT NULL DEFAULT '',
  interval_hours INTEGER NOT NULL DEFAULT 6,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  etag TEXT, last_modified TEXT,
  last_success_run INTEGER, last_success_at TEXT, last_success_count INTEGER,
  next_run_at TEXT,
  lock_until TEXT                                -- one running import per feed
) STRICT;

CREATE TABLE hotels (
  id INTEGER PRIMARY KEY,                        -- same id as wp_kakapo_hotels.id (URLs use slug, id only for /go and merges)
  slug TEXT NOT NULL UNIQUE,
  dedup_key TEXT NOT NULL UNIQUE,
  giata_id INTEGER,
  name TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '', country_slug TEXT NOT NULL DEFAULT '',
  destination TEXT NOT NULL DEFAULT '', destination_slug TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '', city_slug TEXT NOT NULL DEFAULT '',
  stars INTEGER NOT NULL DEFAULT 0,
  rating REAL, rating_count INTEGER NOT NULL DEFAULT 0,
  lat REAL, lng REAL,
  description TEXT, description_source TEXT NOT NULL DEFAULT '',  -- 'kakapo' = editorial, import never overwrites
  images_json TEXT, images_source TEXT NOT NULL DEFAULT '',
  amenities_json TEXT,
  -- denormalised aggregates, recomputed after each import (listings never aggregate offers on the fly)
  min_price INTEGER, prev_min_price INTEGER, price_drop_pct INTEGER NOT NULL DEFAULT 0,
  offers_active INTEGER NOT NULL DEFAULT 0, offers_last_seen TEXT,
  partners_count INTEGER NOT NULL DEFAULT 0,
  has_last_minute INTEGER NOT NULL DEFAULT 0, has_first_minute INTEGER NOT NULL DEFAULT 0, has_all_inclusive INTEGER NOT NULL DEFAULT 0,
  meal_flags INTEGER NOT NULL DEFAULT 0,
  airports_csv TEXT NOT NULL DEFAULT '',
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0,1)),      -- admin: skrýt
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_hotels_country ON hotels(country_slug, offers_active, min_price);
CREATE INDEX idx_hotels_dest ON hotels(destination_slug, offers_active, min_price);
CREATE INDEX idx_hotels_lm ON hotels(has_last_minute, min_price) WHERE has_last_minute = 1;
CREATE INDEX idx_hotels_fm ON hotels(has_first_minute, min_price) WHERE has_first_minute = 1;
CREATE INDEX idx_hotels_drop ON hotels(price_drop_pct, min_price) WHERE price_drop_pct > 0;
CREATE INDEX idx_hotels_giata ON hotels(giata_id) WHERE giata_id IS NOT NULL;

CREATE TABLE hotel_aliases (
  alias_key TEXT PRIMARY KEY,                    -- manual merge only, never fuzzy matching
  hotel_id INTEGER NOT NULL REFERENCES hotels(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_aliases_hotel ON hotel_aliases(hotel_id);

CREATE TABLE offers (
  id INTEGER PRIMARY KEY,                        -- same id as wp_kakapo_offers.id so /go/{id} links stay valid
  hotel_id INTEGER NOT NULL REFERENCES hotels(id),
  feed_id INTEGER NOT NULL REFERENCES feeds(id),
  partner_slug TEXT NOT NULL,
  external_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,                    -- stable hash of normalised fields, no timestamps
  title TEXT NOT NULL DEFAULT '',
  price_pp INTEGER NOT NULL CHECK (price_pp > 0),
  price_total INTEGER, price_original INTEGER, prev_price_pp INTEGER, price_changed_at TEXT,
  currency TEXT NOT NULL DEFAULT 'CZK' CHECK (length(currency) = 3),
  price_basis TEXT NOT NULL DEFAULT 'person',    -- person | room | booking
  departure_date TEXT NOT NULL, return_date TEXT,
  nights INTEGER NOT NULL DEFAULT 7, days INTEGER NOT NULL DEFAULT 8,
  meal_type TEXT NOT NULL DEFAULT 'bez-stravy',
  transport TEXT NOT NULL DEFAULT 'letecky',
  airport TEXT NOT NULL DEFAULT '', airport_slug TEXT NOT NULL DEFAULT '', arrival_airport TEXT NOT NULL DEFAULT '',
  room_type TEXT NOT NULL DEFAULT '',
  adults INTEGER NOT NULL DEFAULT 2, children INTEGER NOT NULL DEFAULT 0,
  availability TEXT NOT NULL DEFAULT 'available',
  is_last_minute INTEGER NOT NULL DEFAULT 0, is_first_minute INTEGER NOT NULL DEFAULT 0,
  affiliate_url TEXT NOT NULL,                   -- stored exactly as delivered/built, never re-encoded
  image_url TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  seen_run INTEGER NOT NULL DEFAULT 0,           -- import run that last wrote the row (not touched when unchanged)
  last_seen TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (feed_id, external_id)
) STRICT;
CREATE INDEX idx_offers_hotel ON offers(hotel_id, price_pp) WHERE active = 1;
CREATE INDEX idx_offers_search ON offers(departure_date, price_pp) WHERE active = 1;
CREATE INDEX idx_offers_airport ON offers(airport_slug, price_pp) WHERE active = 1;
CREATE INDEX idx_offers_meal ON offers(meal_type, price_pp) WHERE active = 1;

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  feed_id INTEGER NOT NULL REFERENCES feeds(id),
  partner_slug TEXT NOT NULL,
  external_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'zajezdy', type_raw TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL, description TEXT,
  image_url TEXT, images_json TEXT,
  price INTEGER NOT NULL CHECK (price > 0), price_original INTEGER,
  currency TEXT NOT NULL DEFAULT 'CZK',
  country TEXT NOT NULL DEFAULT '', country_slug TEXT NOT NULL DEFAULT '',
  destination TEXT NOT NULL DEFAULT '', place TEXT NOT NULL DEFAULT '',
  nights INTEGER, date_from TEXT, date_to TEXT,
  meal TEXT NOT NULL DEFAULT '', transport TEXT NOT NULL DEFAULT '',
  affiliate_url TEXT NOT NULL, meta_json TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0,1)),
  seen_run INTEGER NOT NULL DEFAULT 0,
  last_seen TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (feed_id, external_id)
) STRICT;
CREATE INDEX idx_products_type ON products(type, price) WHERE active = 1;
CREATE INDEX idx_products_country ON products(country_slug, price) WHERE active = 1;

-- One row per hotel and day, 180 days retention (pruned by the daily job).
CREATE TABLE price_history (
  hotel_id INTEGER NOT NULL, snap_date TEXT NOT NULL, min_price INTEGER NOT NULL,
  PRIMARY KEY (hotel_id, snap_date)
) STRICT, WITHOUT ROWID;

-- Hand-written content that an import must never touch: landing texts, SEO fields, hotel texts.
CREATE TABLE editorial_overrides (
  kind TEXT NOT NULL CHECK (kind IN ('landing','hotel','product','page')),
  key TEXT NOT NULL,                             -- landing path, hotel slug, ...
  field TEXT NOT NULL,                           -- h1 | title | description | intro | seo_text | faqs_json | robots | canonical
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, key, field)
) STRICT, WITHOUT ROWID;

CREATE TABLE redirects (
  from_path TEXT PRIMARY KEY,                    -- normalised: lower-case path with trailing slash, no query
  to_path TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 301 CHECK (status IN (301,302,308,410)),
  reason TEXT NOT NULL DEFAULT '',               -- merge | legacy | alias | manual
  created_at TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id INTEGER NOT NULL REFERENCES feeds(id),
  started_at TEXT NOT NULL, finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','failed','aborted','suspicious')),
  items_read INTEGER NOT NULL DEFAULT 0, items_new INTEGER NOT NULL DEFAULT 0, items_changed INTEGER NOT NULL DEFAULT 0,
  items_unchanged INTEGER NOT NULL DEFAULT 0, items_rejected INTEGER NOT NULL DEFAULT 0, items_deactivated INTEGER NOT NULL DEFAULT 0,
  rows_written INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER, snapshot_key TEXT,
  checkpoint_json TEXT,                          -- block index etc. for resume, never raw feed content
  message TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX idx_runs_feed ON import_runs(feed_id, started_at);

CREATE TABLE import_errors (
  run_id INTEGER NOT NULL REFERENCES import_runs(id), external_id TEXT, reason TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_errors_run ON import_errors(run_id);

CREATE TABLE clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER NOT NULL, hotel_id INTEGER NOT NULL DEFAULT 0, product_id INTEGER NOT NULL DEFAULT 0,
  partner_slug TEXT NOT NULL DEFAULT '', context TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '', clicked_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_clicks_date ON clicks(clicked_at);

-- Mapping WordPress -> new keys, kept for the migration report and for late redirects.
CREATE TABLE wp_id_map (
  entity TEXT NOT NULL, wp_id INTEGER NOT NULL, new_key TEXT NOT NULL,
  PRIMARY KEY (entity, wp_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT ''
) STRICT;
