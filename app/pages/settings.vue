<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useSeoMeta({ title: 'Settings' })

const { user, logout } = useAuth()

async function handleLogout() {
  await logout()
  navigateTo('/')
}
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
    <h1 class="font-display text-2xl sm:text-3xl font-bold mb-8">Settings</h1>

    <!-- Account info -->
    <div class="glass-card p-6 mb-6">
      <h2 class="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">Account</h2>

      <div class="space-y-4">
        <div>
          <label class="text-xs text-zinc-500">Email</label>
          <p class="text-sm text-white">{{ user?.email || '—' }}</p>
        </div>
        <div>
          <label class="text-xs text-zinc-500">Name</label>
          <p class="text-sm text-white">{{ user?.name || 'Not set' }}</p>
        </div>
      </div>
    </div>

    <!-- Danger zone -->
    <div class="glass-card p-6 border-red-500/10">
      <h2 class="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">Session</h2>
      <UButton
        color="error"
        variant="outline"
        @click="handleLogout"
      >
        Sign Out
      </UButton>
    </div>
  </div>
</template>
