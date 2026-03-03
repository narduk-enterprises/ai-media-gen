import { z } from 'zod'



const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  // Rate limit: 5 signup attempts per minute per IP
  await enforceRateLimit(event, 'auth-signup', 5, 60_000)
  const body = await readBody(event)
  const parsed = signupSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error?.issues[0]?.message || 'Invalid input' })
  }

  const { email, password, name } = parsed.data

  // Check for existing user
  const existing = await getUserByEmail(event, email)
  if (existing) {
    throw createError({ statusCode: 409, message: 'An account with this email already exists' })
  }

  const user = await createUser(event, email, password, name)
  const sessionId = await createSession(event, user.id)

  setCookie(event, 'session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  })

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  }
})
