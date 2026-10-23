-- Referenced images include objects reused from other shares. Keep physical
-- storage/account/operation guards and additionally bound each share's content.
-- Both reservation and reuse writes include in-flight uploads, so either order
-- of concurrent requests observes the other request's committed capacity.
CREATE TRIGGER reserve_share_reference_limit BEFORE INSERT ON share_upload_reservations
BEGIN
 SELECT CASE WHEN
 (SELECT COALESCE(SUM(bytes),0) FROM share_media WHERE share_id=NEW.share_id)+
 (SELECT COALESCE(SUM(bytes),0) FROM share_upload_reservations WHERE share_id=NEW.share_id)+NEW.bytes>50000000
 THEN RAISE(ABORT,'UPLOAD_BOOK_LIMIT') END;
 SELECT CASE WHEN
 (SELECT COUNT(*) FROM share_media WHERE share_id=NEW.share_id)+
 (SELECT COUNT(*) FROM share_upload_reservations WHERE share_id=NEW.share_id)>=64
 THEN RAISE(ABORT,'UPLOAD_BOOK_LIMIT') END;
END;
