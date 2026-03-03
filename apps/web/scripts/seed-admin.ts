/**
 * Seed script: Creates a local admin user via the dev server API.
 *
 * Usage (from the web/ directory):
 *   npx tsx scripts/seed-admin.ts
 *
 * Requires the dev server to be running (npx nuxt dev --port 3333).
 */

const DEV_URL = 'http://localhost:3333'

async function main() {
  console.log('🔧 Seeding local admin user...\n')

  try {
    const res = await fetch(`${DEV_URL}/api/auth/seed-admin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'seed-script',
      },
    })
    const data = await res.json() as any

    if (res.ok) {
      console.log(`✅ ${data.message}`)
      console.log(`\n   Email:    admin@test.com`)
      console.log(`   Password: admin123`)
      console.log(`   URL:      ${DEV_URL}/login`)
    } else {
      console.error(`❌ ${data.message || JSON.stringify(data)}`)
    }
  } catch (e: any) {
    console.error(`❌ Could not reach dev server at ${DEV_URL}. Is it running?`)
    console.error(`   Start with: cd web && npx nuxt dev --port 3333`)
    process.exit(1)
  }
}

main()
