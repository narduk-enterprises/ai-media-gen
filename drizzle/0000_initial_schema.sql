-- AI Media Gen schema
-- Users and sessions (from initial template)
-- Generations and media items (new)

CREATE TABLE IF NOT EXISTS `users` (
  `id` text PRIMARY KEY NOT NULL,
  `email` text NOT NULL,
  `password_hash` text,
  `name` text,
  `apple_id` text,
  `is_admin` integer DEFAULT false,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `users_email_unique` ON `users` (`email`);
CREATE UNIQUE INDEX IF NOT EXISTS `users_apple_id_unique` ON `users` (`apple_id`);

CREATE TABLE IF NOT EXISTS `sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `expires_at` integer NOT NULL,
  `created_at` text NOT NULL
);

CREATE TABLE IF NOT EXISTS `generations` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `prompt` text NOT NULL,
  `image_count` integer NOT NULL DEFAULT 1,
  `status` text NOT NULL DEFAULT 'pending',
  `error` text,
  `created_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `generations_user_id_idx` ON `generations` (`user_id`);
CREATE INDEX IF NOT EXISTS `generations_created_at_idx` ON `generations` (`created_at`);

CREATE TABLE IF NOT EXISTS `media_items` (
  `id` text PRIMARY KEY NOT NULL,
  `generation_id` text NOT NULL REFERENCES `generations`(`id`) ON DELETE CASCADE,
  `type` text NOT NULL,
  `parent_id` text,
  `url` text,
  `status` text NOT NULL DEFAULT 'pending',
  `error` text,
  `metadata` text,
  `created_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `media_items_generation_id_idx` ON `media_items` (`generation_id`);
CREATE INDEX IF NOT EXISTS `media_items_parent_id_idx` ON `media_items` (`parent_id`);
