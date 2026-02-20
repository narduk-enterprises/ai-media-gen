-- Add dismissed_at to media_items for queue sidebar soft-delete
ALTER TABLE media_items ADD COLUMN dismissed_at TEXT;
