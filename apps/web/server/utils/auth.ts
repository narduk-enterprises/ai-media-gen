import { eq } from 'drizzle-orm'
import { users, sessions } from '../database/schema'
import type { H3Event } from 'h3'

/**
 * Verify a password against a stored hash.
 */
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, _expectedHash] = stored.split(':')
  if (!saltHex || !_expectedHash) return false
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)))
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    256,
  )
  const hashHex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return hashHex === _expectedHash
}

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
