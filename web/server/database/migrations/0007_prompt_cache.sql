-- Prompt Cache: pre-generated prompts for fast retrieval

CREATE TABLE IF NOT EXISTS `prompt_cache` (
  `id` text PRIMARY KEY NOT NULL,
  `template_id` text REFERENCES `prompt_templates`(`id`) ON DELETE SET NULL,
  `template_name` text,
  `raw_prompt` text NOT NULL,
  `refined_prompt` text NOT NULL,
  `similarity_hash` text,
  `created_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `prompt_cache_created_at_idx` ON `prompt_cache` (`created_at`);
