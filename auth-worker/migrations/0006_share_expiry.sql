ALTER TABLE book_shares ADD COLUMN last_access_at INTEGER NOT NULL DEFAULT 0;
UPDATE book_shares SET last_access_at=created_at WHERE last_access_at=0;
CREATE INDEX IF NOT EXISTS book_shares_last_access ON book_shares(last_access_at);
CREATE TABLE IF NOT EXISTS share_objects (
 object_key TEXT PRIMARY KEY NOT NULL,
 share_id TEXT NOT NULL,
 bytes INTEGER NOT NULL,
 created_at INTEGER NOT NULL
) WITHOUT ROWID;
INSERT OR IGNORE INTO share_objects(object_key,share_id,bytes,created_at)
 SELECT object_key,share_id,bytes,CAST(strftime('%s','now') AS INTEGER)*1000 FROM share_media;
