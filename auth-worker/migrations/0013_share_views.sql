ALTER TABLE book_shares ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE share_history ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;
-- Retire generated ticket images; source artwork and text stay intact.
DELETE FROM share_media WHERE role='card';
