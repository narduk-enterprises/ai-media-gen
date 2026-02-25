-- Add media_type and model_hint columns to prompt templates and cache
-- media_type: 'image', 'video', or 'any' (default 'any' for backward compat)
-- model_hint: optional model-specific hint (e.g., 'pony', 'wan22', 'flux2')

ALTER TABLE `prompt_templates` ADD COLUMN `media_type` text DEFAULT 'any';
ALTER TABLE `prompt_templates` ADD COLUMN `model_hint` text;

ALTER TABLE `prompt_cache` ADD COLUMN `media_type` text DEFAULT 'any';
ALTER TABLE `prompt_cache` ADD COLUMN `model_hint` text;

CREATE INDEX IF NOT EXISTS `prompt_templates_media_type_idx` ON `prompt_templates` (`media_type`);
CREATE INDEX IF NOT EXISTS `prompt_templates_model_hint_idx` ON `prompt_templates` (`model_hint`);
CREATE INDEX IF NOT EXISTS `prompt_cache_media_type_idx` ON `prompt_cache` (`media_type`);
