-- Offers hidden by an editor from the admin. The import MUST skip these (feed_id, external_id) and keep them inactive,
-- otherwise the next feed run would re-activate a hidden offer. Rows are removed again from the admin ("obnovit").
CREATE TABLE offer_blocklist (
  feed_id INTEGER NOT NULL,
  external_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (feed_id, external_id)
) STRICT, WITHOUT ROWID;
