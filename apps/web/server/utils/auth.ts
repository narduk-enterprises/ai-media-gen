import { eq } from 'drizzle-orm'
import { users, sessions } from '../database/schema'
import type { H3Event } from 'h3'

/**
 * Hash a password using Web Crypto (PBKDF2).
 */
export async function hashPassword(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16))
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
    const hashHex = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('')
    const saltHex = [...salt].map(b => b.toString(16).padStart(2, '0')).join('')
    return `${saltHex}:${hashHex}`
}

/**
 * Verify a password against a stored hash.
 */
async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const [saltHex, _expectedHash] = stored.split(':')
    if (!saltHex || !_expectedHash) return false
    const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => Number.parseInt(h, 16)))
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
    const hashHex = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('')
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
 * Create a session for a user and return the session ID.
 */
export async function createSession(event: H3Event, userId: string): Promise<string> {
    const db = useDatabase(event)
    const id = crypto.randomUUID()
    const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 // 30 days
    const now = new Date().toISOString()

    await db.insert(sessions).values({ id, userId, expiresAt, createdAt: now })
    return id
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

interface AuthUser {
    id: string
    email: string
    name: string | null
    isAdmin: boolean | null
}

/**
 * Require an authenticated user. Throws 401 if not logged in.
 */
export async function requireAuth(event: H3Event): Promise<AuthUser> {
    const user = event.context._authUser as AuthUser | null
    if (!user) {
        throw createError({ statusCode: 401, message: 'Authentication required' })
    }
    return user
}

/**
 * Require an admin user. Throws 403 if not admin.
 */
export async function requireAdmin(event: H3Event): Promise<AuthUser> {
    const user = await requireAuth(event)
    if (!user.isAdmin) {
        throw createError({ statusCode: 403, message: 'Admin access required' })
    }
    return user
}
