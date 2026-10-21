CREATE TABLE IF NOT EXISTS share_rate_limits (
 owner_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 window_start INTEGER NOT NULL,
 used INTEGER NOT NULL,
 last_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id,kind)
) WITHOUT ROWID;
