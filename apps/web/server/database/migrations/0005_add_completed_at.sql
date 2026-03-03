-- Add completed_at column to media_items for tracking generation duration
ALTER TABLE media_items ADD COLUMN completed_at TEXT;
