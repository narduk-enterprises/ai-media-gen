
/**
 * Server middleware to init D1 database on every request.
 */
export default defineEventHandler((event) => {
  const DB = event.context.cloudflare?.env?.DB || (globalThis as any).__env__?.DB || process.env?.DB

  if (DB) {
    initDatabase(DB)
  }
})
