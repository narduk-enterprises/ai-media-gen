/**
 * POST /api/runpod/deploy
 *
 * Deploy a new GPU pod with automated setup.
 * The pod auto-bootstraps: clones repo, installs ComfyUI, syncs models, starts services.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readBody(event)

  if (!body.name || !body.templateId || !body.gpuTypeId || !body.gpuCount) {
    throw createError({ statusCode: 400, message: 'Missing required deployment parameters' })
  }

  const podId = await deployRunPod(body.name, body.templateId, body.gpuTypeId, body.gpuCount, {
    cloudType: body.cloudType,
    dataCenterId: body.dataCenterId,
    volumeInGb: body.volumeInGb,
    containerDiskInGb: body.containerDiskInGb,
    modelGroups: body.modelGroups || [],
  })

  return { success: true, podId }
})
