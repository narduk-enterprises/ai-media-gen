-- Track RunPod job IDs and per-item prompts so stale generations can be recovered
ALTER TABLE `media_items` ADD COLUMN `runpod_job_id` text;
ALTER TABLE `media_items` ADD COLUMN `prompt` text;
