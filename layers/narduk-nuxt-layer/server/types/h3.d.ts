import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type * as schema from '../database/schema'

declare module 'h3' {
  interface H3EventContext {
    /** Per-request Drizzle D1 database instance, memoized by useDatabase() */
    _db?: DrizzleD1Database<typeof schema>
  }
}
