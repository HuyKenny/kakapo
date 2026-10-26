-- First photo for which the wsrv.nl cache was pre-warmed (import Worker, engine/warm.ts). NULL or a different first photo = to do.
ALTER TABLE hotels ADD COLUMN img_warm TEXT;
ALTER TABLE products ADD COLUMN img_warm TEXT;
