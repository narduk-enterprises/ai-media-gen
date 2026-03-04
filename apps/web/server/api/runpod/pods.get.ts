export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  try {
    const pods = await getRunPods()
    return { pods }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: strict type
  } catch (err: any) {
    console.error('Failed to get pods:', err)
    throw createError({ statusCode: err.statusCode || 500, statusMessage: err.statusMessage || 'Failed to fetch pods' })
  }
})
