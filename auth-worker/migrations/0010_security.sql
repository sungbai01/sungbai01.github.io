CREATE TABLE IF NOT EXISTS share_upload_reservations (
 object_key TEXT PRIMARY KEY NOT NULL,
 share_id TEXT NOT NULL,
 bytes INTEGER NOT NULL CHECK(bytes>0 AND bytes<=2000000),
 created_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS share_uploads_share ON share_upload_reservations(share_id);
CREATE INDEX IF NOT EXISTS share_objects_share ON share_objects(share_id);
CREATE TRIGGER IF NOT EXISTS reserve_share_upload BEFORE INSERT ON share_upload_reservations
BEGIN
 SELECT CASE WHEN (SELECT reserved_bytes FROM share_storage_budget WHERE id=1)+NEW.bytes>1000000000 THEN RAISE(ABORT,'UPLOAD_STORAGE_LIMIT') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM share_objects WHERE share_id=NEW.share_id)+(SELECT COUNT(*) FROM share_upload_reservations WHERE share_id=NEW.share_id)>=64 THEN RAISE(ABORT,'UPLOAD_BOOK_LIMIT') END;
 SELECT CASE WHEN (SELECT COALESCE(SUM(bytes),0) FROM share_objects WHERE share_id=NEW.share_id)+(SELECT COALESCE(SUM(bytes),0) FROM share_upload_reservations WHERE share_id=NEW.share_id)+NEW.bytes>50000000 THEN RAISE(ABORT,'UPLOAD_BOOK_LIMIT') END;
 SELECT CASE WHEN COALESCE((SELECT writes FROM share_operation_budget WHERE month=strftime('%Y-%m','now')),0)>=10000 THEN RAISE(ABORT,'UPLOAD_OPERATION_LIMIT') END;
 UPDATE share_storage_budget SET reserved_bytes=reserved_bytes+NEW.bytes WHERE id=1;
 INSERT INTO share_operation_budget(month,writes) VALUES(strftime('%Y-%m','now'),1) ON CONFLICT(month) DO UPDATE SET writes=writes+1;
END;
CREATE TABLE IF NOT EXISTS auth_sessions (
 session_id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS public_read_budget (
 day TEXT PRIMARY KEY NOT NULL,
 used INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
