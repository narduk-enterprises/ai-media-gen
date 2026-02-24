import { getLogs } from '../../utils/podClient'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const podId = query.podId as string
  const source = (query.source as 'comfy' | 'admin') || 'admin'
  const lines = parseInt(query.lines as string) || 80

  if (!podId) {
    throw createError({ statusCode: 400, message: 'podId is required' })
  }

  const podUrl = `https://${podId}-8188.proxy.runpod.net`
  const logText = await getLogs(source, lines, podUrl)

  return { logs: logText || 'No logs available' }
})
