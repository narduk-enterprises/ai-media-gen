export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const body = await readBody(event)
  if (!body?.podId) throw createError({ statusCode: 400, statusMessage: 'Missing podId' })

  try {
    await stopRunPod(body.podId)
    return { success: true }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: strict type
  } catch (err: any) {
    throw createError({ statusCode: err.statusCode || 500, statusMessage: err.statusMessage || 'Failed to stop pod' })
  }
})
