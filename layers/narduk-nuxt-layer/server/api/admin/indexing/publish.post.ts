import { z } from 'zod'

const bodySchema = z.object({
    url: z.string().url(),
    type: z
        .enum(['URL_UPDATED', 'URL_DELETED'])
        .optional()
        .default('URL_UPDATED'),
})

import { requireLayerAdmin } from '../../../utils/auth'

/**
 * Google Indexing API — publish a single URL notification.
 *
 * POST /api/admin/indexing/publish
 * JSON body: { url: string, action?: 'URL_UPDATED' | 'URL_DELETED' }
 *
 * Notifies Google that a URL has been updated or should be removed.
 * Requires GSC_SERVICE_ACCOUNT_JSON with the API enabled.
 *
 * Note: officially Google limits the Indexing API to pages with JobPosting (or
 * BroadcastEvent) structured data, but it may work for other page types.
 *
 * Usage:
 * curl -X POST https://ai-media-gen.com/api/admin/indexing/publish \
 *   -H "Content-Type: application/json" \
 *   -d '{ "url": "https://ai-media-gen.com/page1", "action": "URL_UPDATED" }'
 */
export default defineEventHandler(async (event) => {
    await requireLayerAdmin(event)
    await enforceRateLimit(event, 'google-indexing-publish', 10, 60_000)

    const body = await readBody<unknown>(event)
    const parsed = bodySchema.safeParse(body)

    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            statusMessage: `Validation error: ${parsed.error.issues.map(i => i.message).join(', ')}`,
        })
    }

    const { url, type } = parsed.data

    try {
        const data = await googleApiFetch(
            'https://indexing.googleapis.com/v3/urlNotifications:publish',
            INDEXING_SCOPES,
            {
                method: 'POST',
                body: JSON.stringify({ url, type }),
            },
        )

        return {
            success: true,
            url,
            type,
            metadata: data,
        }
    } catch (error: unknown) {
        const err = error as { statusCode?: number; statusMessage?: string; message?: string }
        throw createError({
            statusCode: err.statusCode || 500,
            statusMessage: `Google Indexing API error: ${err.statusMessage || err.message}`,
        })
    }
})
