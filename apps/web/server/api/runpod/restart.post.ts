/**
 * POST /api/runpod/restart
 *
 * Stop a pod, wait for it to fully stop, then start it again.
 * Accepts { podId }
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const body = await readBody(event)
  if (!body?.podId) throw createError({ statusCode: 400, statusMessage: 'Missing podId' })

  const podId = body.podId

  try {
    // Stop the pod
    await stopRunPod(podId)

    // Poll until pod is actually stopped (max 60s)
    const maxWait = 60_000
    const start = Date.now()
    let stopped = false

    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 3000))
      const pods = await getRunPods()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: strict type
      const pod = pods.find((p: any) => p.id === podId)
      if (!pod || pod.status === 'EXITED' || pod.status === 'STOPPED') {
        stopped = true
        break
      }
    }

    if (!stopped) {
      return { success: false, message: 'Pod did not stop in time. Try starting it manually.' }
    }

    // Wait a moment for RunPod to fully register the stop
    await new Promise(r => setTimeout(r, 2000))

    // Start the pod back up
    await startRunPod(podId)

    return { success: true, message: 'Pod restarting — it will auto-update code and verify models on boot.' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: strict type
  } catch (err: any) {
    throw createError({ statusCode: err.statusCode || 500, statusMessage: err.statusMessage || 'Failed to restart pod' })
  }
})
