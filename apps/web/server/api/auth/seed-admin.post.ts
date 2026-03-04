/**
 * POST /api/auth/seed-admin (DEV ONLY)
 * Creates a test admin user for local development.
 * Also ensures the database tables exist.
 * Only available when running in development mode.
 */
import { users } from '../../database/schema'

import { eq } from 'drizzle-orm'

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY NOT NULL, email text NOT NULL, password_hash text,
    name text, apple_id text, is_admin integer DEFAULT false,
    created_at text NOT NULL, updated_at text NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at integer NOT NULL, created_at text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS generations (
    id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prompt text NOT NULL, image_count integer NOT NULL DEFAULT 1,
    status text NOT NULL DEFAULT 'pending', settings text, error text, created_at text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS media_items (
    id text PRIMARY KEY NOT NULL, generation_id text NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
    type text NOT NULL, parent_id text, url text, status text NOT NULL DEFAULT 'pending',
    error text, metadata text, runpod_job_id text, prompt text, quality_score real,
    submitted_at text, completed_at text, dismissed_at text, created_at text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS prompt_templates (
    id text PRIMARY KEY NOT NULL, name text NOT NULL, template text NOT NULL,
    category text DEFAULT 'general', is_active integer DEFAULT 1,
    created_at text NOT NULL, updated_at text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS prompt_attributes (
    id text PRIMARY KEY NOT NULL, category text NOT NULL, value text NOT NULL,
    weight real DEFAULT 1.0, is_active integer DEFAULT 1,
    created_at text NOT NULL, updated_at text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS prompt_generation_log (
    id text PRIMARY KEY NOT NULL, template_id text REFERENCES prompt_templates(id) ON DELETE SET NULL,
    raw_prompt text NOT NULL, refined_prompt text, similarity_hash text,
    user_id text REFERENCES users(id) ON DELETE SET NULL, created_at text NOT NULL
  )`,
]

export default defineEventHandler(async (event) => {
  // Block in production
  if (!import.meta.dev) {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const d1 = event.context.cloudflare?.env?.DB as D1Database | undefined
  if (!d1) {
    throw createError({ statusCode: 500, message: 'D1 binding not available' })
  }

  // Ensure tables exist via individual prepared statements
  for (const sql of SCHEMA_STATEMENTS) {
    try {
      await d1.prepare(sql).run()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: strict type
    } catch (e: any) {
      // Ignore "already exists" errors from indexes etc
      if (!e.message?.includes('already exists')) {
        console.warn(`[seed-admin] Schema statement warning: ${e.message}`)
      }
    }
  }

  const db = useDatabase(event)
  const email = 'admin@test.com'
  const password = 'admin123'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: strict type
  let existing: any = null
  try {
    existing = await getUserByEmail(event, email)
  } catch { /* table doesn't exist yet */ }

  if (!existing) {
    const id = crypto.randomUUID()
    const passwordHash = await hashPassword(password)
    const now = new Date().toISOString()

    await db.insert(users).values({
      id,
      email,
      passwordHash,
      name: 'Admin',
      isAdmin: true,
      createdAt: now,
      updatedAt: now,
    })

    return { created: true, email, message: 'Admin user created and promoted' }
  }

  if (!existing.isAdmin) {
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, existing.id))
    return { created: false, promoted: true, email, message: 'Existing user promoted to admin' }
  }

  return { created: false, promoted: false, email, message: 'Admin user already exists' }
})
