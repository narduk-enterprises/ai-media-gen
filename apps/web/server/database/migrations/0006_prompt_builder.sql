-- Prompt Builder: templates, attributes, and generation log

CREATE TABLE IF NOT EXISTS `prompt_templates` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `template` text NOT NULL,
  `category` text DEFAULT 'general',
  `is_active` integer DEFAULT 1,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `prompt_templates_category_idx` ON `prompt_templates` (`category`);
CREATE INDEX IF NOT EXISTS `prompt_templates_is_active_idx` ON `prompt_templates` (`is_active`);

CREATE TABLE IF NOT EXISTS `prompt_attributes` (
  `id` text PRIMARY KEY NOT NULL,
  `category` text NOT NULL,
  `value` text NOT NULL,
  `weight` real DEFAULT 1.0,
  `is_active` integer DEFAULT 1,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `prompt_attributes_category_idx` ON `prompt_attributes` (`category`);
CREATE INDEX IF NOT EXISTS `prompt_attributes_is_active_idx` ON `prompt_attributes` (`is_active`);

CREATE TABLE IF NOT EXISTS `prompt_generation_log` (
  `id` text PRIMARY KEY NOT NULL,
  `template_id` text REFERENCES `prompt_templates`(`id`) ON DELETE SET NULL,
  `raw_prompt` text NOT NULL,
  `refined_prompt` text,
  `similarity_hash` text,
  `user_id` text REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `prompt_generation_log_user_id_idx` ON `prompt_generation_log` (`user_id`);
CREATE INDEX IF NOT EXISTS `prompt_generation_log_created_at_idx` ON `prompt_generation_log` (`created_at`);
CREATE INDEX IF NOT EXISTS `prompt_generation_log_similarity_hash_idx` ON `prompt_generation_log` (`similarity_hash`);
