ALTER TABLE book_shares ADD COLUMN title TEXT NOT NULL DEFAULT '';
UPDATE book_shares SET title=substr(json_extract(body,'$.title'),1,200);
CREATE TABLE IF NOT EXISTS share_history (
 share_id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL,
 book_id TEXT NOT NULL,
 title TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expired_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS share_history_owner ON share_history(owner_id,expired_at);
