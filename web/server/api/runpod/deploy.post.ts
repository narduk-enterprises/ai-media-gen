export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readBody(event)
  
  if (!body.name || !body.templateId || !body.gpuTypeId || !body.gpuCount) {
    throw createError({ statusCode: 400, message: 'Missing required deployment parameters' })
  }

  const podId = await deployRunPod(body.name, body.templateId, body.gpuTypeId, body.gpuCount)
  return { success: true, podId }
})
