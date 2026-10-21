CREATE TABLE IF NOT EXISTS books (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  body TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL CHECK(revision > 0),
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
  bytes INTEGER NOT NULL DEFAULT 0 CHECK(bytes >= 0),
  PRIMARY KEY(owner_id,book_id)
) WITHOUT ROWID;
