CREATE TABLE IF NOT EXISTS book_shares (
  share_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  body TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(owner_id, book_id)
);
CREATE INDEX IF NOT EXISTS book_shares_owner ON book_shares(owner_id);
