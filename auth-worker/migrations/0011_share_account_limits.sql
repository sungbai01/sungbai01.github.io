ALTER TABLE share_upload_reservations ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE share_upload_reservations SET owner_id=COALESCE((SELECT owner_id FROM book_shares WHERE share_id=share_upload_reservations.share_id),(SELECT owner_id FROM share_history WHERE share_id=share_upload_reservations.share_id),'');
CREATE TABLE share_object_info (
 object_key TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL,
 content_hash TEXT,
 deleting INTEGER NOT NULL DEFAULT 0 CHECK(deleting IN (0,1))
) WITHOUT ROWID;
CREATE INDEX share_object_info_hash ON share_object_info(owner_id,content_hash,deleting);
INSERT OR IGNORE INTO share_object_info(object_key,owner_id)
 SELECT object_key,COALESCE((SELECT owner_id FROM book_shares WHERE share_id=share_objects.share_id),(SELECT owner_id FROM share_history WHERE share_id=share_objects.share_id),'') FROM share_objects;
CREATE TRIGGER reserve_account_share_upload BEFORE INSERT ON share_upload_reservations
BEGIN
 SELECT CASE WHEN
 (SELECT COALESCE(SUM(o.bytes),0) FROM share_objects o JOIN share_object_info i ON i.object_key=o.object_key WHERE i.owner_id=COALESCE(NULLIF(NEW.owner_id,''),(SELECT owner_id FROM book_shares WHERE share_id=NEW.share_id)))+
 (SELECT COALESCE(SUM(bytes),0) FROM share_upload_reservations WHERE owner_id=COALESCE(NULLIF(NEW.owner_id,''),(SELECT owner_id FROM book_shares WHERE share_id=NEW.share_id)))+NEW.bytes>100000000
 THEN RAISE(ABORT,'UPLOAD_ACCOUNT_LIMIT') END;
END;
CREATE TRIGGER fill_share_upload_owner AFTER INSERT ON share_upload_reservations WHEN NEW.owner_id=''
BEGIN
 UPDATE share_upload_reservations SET owner_id=COALESCE((SELECT owner_id FROM book_shares WHERE share_id=NEW.share_id),'') WHERE object_key=NEW.object_key;
END;
CREATE TABLE share_card_layout (
 share_id TEXT PRIMARY KEY NOT NULL,
 title TEXT NOT NULL,
 quote TEXT NOT NULL,
 page_start INTEGER,
 page_end INTEGER,
 image_position REAL NOT NULL DEFAULT 0,
 background_url TEXT
) WITHOUT ROWID;
