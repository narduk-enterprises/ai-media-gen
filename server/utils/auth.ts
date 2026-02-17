import { eq, and, gt } from 'drizzle-orm'
import { users, sessions } from '../database/schema'
import type { User } from '../database/schema'

// ─── Password Hashing (Web Crypto PBKDF2) ──────────────────

const ITERATIONS = 100_000
const HASH_LENGTH = 32 // bytes
const SALT_LENGTH = 16 // bytes

async function deriveKey(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    HASH_LENGTH * 8,
  )
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const derived = await deriveKey(password, salt)
  return `${toHex(salt.buffer as ArrayBuffer)}:${toHex(derived)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const salt = fromHex(saltHex)
  const derived = await deriveKey(password, salt)
  return toHex(derived) === hashHex
}

// ─── User Operations ────────────────────────────────────────

export async function getUserByEmail(email: string): Promise<User | null> {
  const db = useDatabase()
  const result = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1)
  return result[0] ?? null
}

export async function getUserById(id: string): Promise<User | null> {
  const db = useDatabase()
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1)
  return result[0] ?? null
}

export async function createUser(email: string, password: string, name?: string): Promise<User> {
  const db = useDatabase()
  const id = crypto.randomUUID()
  const passwordHash = await hashPassword(password)
  const now = new Date().toISOString()

  await db.insert(users).values({
    id,
    email: email.toLowerCase(),
    passwordHash,
    name: name || null,
    createdAt: now,
    updatedAt: now,
  })

  return { id, email: email.toLowerCase(), passwordHash, name: name || null, appleId: null, isAdmin: false, createdAt: now, updatedAt: now }
}

export async function verifyCredentials(email: string, password: string): Promise<User | null> {
  const user = await getUserByEmail(email)
  if (!user || !user.passwordHash) return null

  const valid = await verifyPassword(password, user.passwordHash)
  return valid ? user : null
}

// ─── Session Operations ─────────────────────────────────────

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export async function createSession(userId: string): Promise<string> {
  const db = useDatabase()
  const id = crypto.randomUUID()
  const now = new Date()
  const expiresAt = Math.floor((now.getTime() + SESSION_DURATION_MS) / 1000)

  await db.insert(sessions).values({
    id,
    userId,
    expiresAt,
    createdAt: now.toISOString(),
  })

  return id
}

export async function getSessionWithUser(sessionId: string): Promise<{ session: typeof sessions.$inferSelect; user: User } | null> {
  const db = useDatabase()
  const now = Math.floor(Date.now() / 1000)

  const result = await db
    .select()
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
    .limit(1)

  if (!result[0]) return null
  return { session: result[0].sessions, user: result[0].users }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const db = useDatabase()
  await db.delete(sessions).where(eq(sessions.id, sessionId))
}

// ─── Auth Helper for API Routes ─────────────────────────────

import type { H3Event } from 'h3'

export async function requireAuth(event: H3Event): Promise<User> {
  const sessionId = getCookie(event, 'session')
  if (!sessionId) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  const result = await getSessionWithUser(sessionId)
  if (!result) {
    throw createError({ statusCode: 401, message: 'Invalid or expired session' })
  }

  return result.user
}
