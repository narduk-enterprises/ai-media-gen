import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

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
  status: text('status').notNull().default('pending'), // pending | processing | complete | failed
  error: text('error'),
  metadata: text('metadata'), // JSON blob: { width, height, duration, etc. }
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
