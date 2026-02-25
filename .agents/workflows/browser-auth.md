---
description: How to authenticate in the browser for local dev testing (admin user)
---

# Browser Authentication for Local Dev

When working in the browser against the local dev server, you need to be authenticated as an admin user. Follow these steps:

## Prerequisites

The dev server must be running:

```bash
cd /Users/narduk/new-code/ai-media-gen/web && npx nuxt dev --port 3333
```

## Step 1: Seed the Admin User (first time only)

// turbo
Run the seed script to create the test admin user:

```bash
cd /Users/narduk/new-code/ai-media-gen/web && npx tsx scripts/seed-admin.ts
```

This calls `POST /api/auth/seed-admin` which:

- Auto-creates all required D1 tables (if missing)
- Creates the admin user
- Promotes them to admin

Credentials:

- **Email:** `admin@test.com`
- **Password:** `admin123`

## Step 2: Log In via Browser

1. Navigate to `http://localhost:3333/login`
2. Enter email: `admin@test.com`
3. Enter password: `admin123`
4. Click "Sign In"
5. You will be redirected to `/create`

## Step 3: Access Admin Pages

Once logged in as admin, you can access:

- `/manage-prompts` — Prompt Builder admin panel (Templates, Attributes, History)
- The "Prompts" nav link will appear in the header for admin users

## Notes

- The seed endpoint only works in dev mode (`import.meta.dev`)
- The admin user is stored in the **local** D1 database only
- If the local DB is wiped (e.g. clearing `.wrangler/state`), re-run the seed script
- The seed script is idempotent — safe to run multiple times
