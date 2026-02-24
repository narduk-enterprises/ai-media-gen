import { z } from 'zod'
import { verifyCredentials, createSession } from '../../utils/auth'
import { enforceRateLimit } from '../../utils/rateLimit'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
})

export default defineEventHandler(async (event) => {
  // Rate limit: 10 login attempts per minute per IP
  await enforceRateLimit(event, 'auth-login', 10, 60_000)
  const body = await readBody(event)
  const parsed = loginSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error?.issues[0]?.message || 'Invalid input' })
  }

  const { email, password } = parsed.data
  const user = await verifyCredentials(email, password)

  if (!user) {
    throw createError({ statusCode: 401, message: 'Invalid email or password' })
  }

  const sessionId = await createSession(user.id)

  setCookie(event, 'session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  })

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  }
})
