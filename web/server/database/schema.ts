import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

// ─── Users ──────────────────────────────────────────────────
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash'),
  name: text('name'),
  appleId: text('apple_id'),
  isAdmin: integer('is_admin', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Sessions ───────────────────────────────────────────────
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Generations ────────────────────────────────────────────
export const generations = sqliteTable('generations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  prompt: text('prompt').notNull(),
  imageCount: integer('image_count').notNull().default(1),
  status: text('status').notNull().default('pending'), // pending | processing | complete | failed
  settings: text('settings'), // JSON blob: { negativePrompt, steps, width, height, attributes, ... }
  error: text('error'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Media Items ────────────────────────────────────────────
export const mediaItems = sqliteTable('media_items', {
  id: text('id').primaryKey(),
  generationId: text('generation_id').notNull().references(() => generations.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'image' | 'video' | 'audio'
  parentId: text('parent_id'), // links video→image, audio→video
  url: text('url'),
  status: text('status').notNull().default('pending'), // pending | queued | processing | complete | failed | cancelled
  error: text('error'),
  metadata: text('metadata'), // JSON blob: RunPod input payload + apiUrl
  runpodJobId: text('runpod_job_id'), // RunPod job ID (null while queued, set when submitted)
  prompt: text('prompt'), // per-item prompt (may differ from generation prompt in "vary per image" mode)
  qualityScore: real('quality_score'), // AI aesthetic score (1-10)
  submittedAt: text('submitted_at'), // when the item was actually sent to RunPod (null while queued)
  completedAt: text('completed_at'), // when the item finished (success or failure)
  dismissedAt: text('dismissed_at'), // when the user dismissed this from the queue sidebar (null = visible)
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Prompt Templates ───────────────────────────────────────
export const promptTemplates = sqliteTable('prompt_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  template: text('template').notNull(),
  category: text('category').default('general'),
  mediaType: text('media_type').default('any'), // 'image' | 'video' | 'any'
  modelHint: text('model_hint'), // optional: 'pony', 'wan22', 'flux2', etc.
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Prompt Attributes ──────────────────────────────────────
export const promptAttributes = sqliteTable('prompt_attributes', {
  id: text('id').primaryKey(),
  category: text('category').notNull(),
  value: text('value').notNull(),
  weight: real('weight').default(1.0),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Prompt Generation Log ──────────────────────────────────
export const promptGenerationLog = sqliteTable('prompt_generation_log', {
  id: text('id').primaryKey(),
  templateId: text('template_id').references(() => promptTemplates.id, { onDelete: 'set null' }),
  rawPrompt: text('raw_prompt').notNull(),
  refinedPrompt: text('refined_prompt'),
  similarityHash: text('similarity_hash'),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Prompt Cache ───────────────────────────────────────────
export const promptCache = sqliteTable('prompt_cache', {
  id: text('id').primaryKey(),
  templateId: text('template_id').references(() => promptTemplates.id, { onDelete: 'set null' }),
  templateName: text('template_name'),
  rawPrompt: text('raw_prompt').notNull(),
  refinedPrompt: text('refined_prompt').notNull(),
  similarityHash: text('similarity_hash'),
  mediaType: text('media_type').default('any'), // 'image' | 'video' | 'any'
  modelHint: text('model_hint'), // optional model hint carried from template
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ─── Type helpers ───────────────────────────────────────────
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Session = typeof sessions.$inferSelect
export type Generation = typeof generations.$inferSelect
export type NewGeneration = typeof generations.$inferInsert
export type MediaItem = typeof mediaItems.$inferSelect
export type NewMediaItem = typeof mediaItems.$inferInsert
export type PromptTemplate = typeof promptTemplates.$inferSelect
export type NewPromptTemplate = typeof promptTemplates.$inferInsert
export type PromptAttribute = typeof promptAttributes.$inferSelect
export type NewPromptAttribute = typeof promptAttributes.$inferInsert
export type PromptGenerationLogEntry = typeof promptGenerationLog.$inferSelect
export type PromptCacheEntry = typeof promptCache.$inferSelect
export type NewPromptCacheEntry = typeof promptCache.$inferInsert
