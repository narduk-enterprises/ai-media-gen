
/**
 * Server middleware to init D1 database on every request.
 */
export default defineEventHandler((event) => {
  const env = event.context.cloudflare?.env || (globalThis as any).__env__ || process.env || {}
  const DB = env.DB
  
  if (DB) {
    initDatabase(DB)
  }
})
