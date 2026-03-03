

export default defineEventHandler(async (event) => {
  const sessionId = getCookie(event, 'session')

  if (sessionId) {
    await deleteSession(event, sessionId)
  }

  deleteCookie(event, 'session', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  })

  return { success: true }
})
