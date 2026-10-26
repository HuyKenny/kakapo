-- Precomputed keyword themes per hotel (children=1, aquapark=2, sandy-beach=4), computed from hotel texts and
-- active offer titles/rooms by computeThemeFlags() (src/lib/themes.ts). Replaces per-query LIKE scans over descriptions.
ALTER TABLE hotels ADD COLUMN theme_flags INTEGER NOT NULL DEFAULT 0;
