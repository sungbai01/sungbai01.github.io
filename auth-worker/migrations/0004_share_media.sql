CREATE TABLE IF NOT EXISTS share_media (
 share_id TEXT NOT NULL,
 image_id TEXT NOT NULL,
 name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('asset','icon','card')),
 object_key TEXT NOT NULL,
 mime TEXT NOT NULL,
 bytes INTEGER NOT NULL,
 PRIMARY KEY(share_id,image_id),
 UNIQUE(share_id,name,role)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS share_storage_budget (
 id INTEGER PRIMARY KEY CHECK(id=1),
 reserved_bytes INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO share_storage_budget(id,reserved_bytes) VALUES(1,0);
CREATE TABLE IF NOT EXISTS share_operation_budget (
 month TEXT PRIMARY KEY,
 reads INTEGER NOT NULL DEFAULT 0,
 writes INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
