import { eq } from 'drizzle-orm'
import { users, sessions } from '../database/schema'
import type { H3Event } from 'h3'

// hashPassword and verifyPassword are auto-imported from the layer's server/utils/password.ts

/**
 * Look up a user by email address.
 */
export async function getUserByEmail(event: H3Event, email: string) {
  const db = useDatabase(event)
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  return user ?? null
}

/**
 * Create a new user with hashed password.
 * Uses the layer-provided `hashPassword` from auto-import.
 */
export async function createUser(event: H3Event, email: string, password: string, name?: string) {
  const db = useDatabase(event)
  const id = crypto.randomUUID()
  const passwordHash = await hashPassword(password)
  const now = new Date().toISOString()

  await db.insert(users).values({
    id,
    email,
    passwordHash,
    name: name ?? null,
    isAdmin: false,
    createdAt: now,
    updatedAt: now,
  })

  return { id, email, name: name ?? null }
}

/**
 * Verify email + password and return the user if valid.
 */
export async function verifyCredentials(event: H3Event, email: string, password: string) {
  const user = await getUserByEmail(event, email)
  if (!user || !user.passwordHash) return null
  const valid = await verifyPassword(password, user.passwordHash)
  return valid ? user : null
}

/**
 * Delete a session by ID.
 */
export async function deleteSession(event: H3Event, sessionId: string): Promise<void> {
  const db = useDatabase(event)
  await db.delete(sessions).where(eq(sessions.id, sessionId))
}

/**
 * Get a session and its associated user.
 */
export async function getSessionWithUser(event: H3Event, sessionId: string) {
  const db = useDatabase(event)
  const results = await db
    .select()
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1)

  const row = results[0]
  if (!row) return null

  // Check expiry
  if (row.sessions.expiresAt < Math.floor(Date.now() / 1000)) {
    await deleteSession(event, sessionId)
    return null
  }

  return { session: row.sessions, user: row.users }
}
