export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const body = await readBody(event)
  if (!body?.podId) throw createError({ statusCode: 400, statusMessage: 'Missing podId' })

  try {
    await startRunPod(body.podId)
    return { success: true }
  } catch (err: any) {
    throw createError({ statusCode: err.statusCode || 500, statusMessage: err.statusMessage || 'Failed to start pod' })
  }
})
