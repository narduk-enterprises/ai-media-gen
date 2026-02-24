import { getSessionWithUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const sessionId = getCookie(event, 'session')

  if (!sessionId) {
    return { user: null }
  }

  const result = await getSessionWithUser(sessionId)

  if (!result) {
    return { user: null }
  }

  return {
    user: {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      isAdmin: result.user.isAdmin,
    },
  }
})
