<script setup lang="ts">
const { login, loggedIn } = useAuth()

// Already logged in? Go to /create
if (loggedIn.value) {
  await navigateTo('/create', { replace: true })
}

useSeoMeta({ title: 'Log In' })

const email = ref('')
const password = ref('')
const error = ref('')
const submitting = ref(false)

async function handleLogin() {
  error.value = ''
  submitting.value = true

  try {
    await login(email.value, password.value)
    navigateTo('/create')
  } catch (e: any) {
    error.value = e.data?.message || e.message || 'Login failed'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4">
    <div class="w-full max-w-md">
      <!-- Back link -->
      <NuxtLink to="/" class="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-white mb-8 transition-colors">
        <UIcon name="i-heroicons-arrow-left" class="w-4 h-4" />
        Back
      </NuxtLink>

      <div class="glass-card p-8">
        <!-- Header -->
        <div class="text-center mb-8">
          <div class="w-14 h-14 mx-auto rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-violet-500/20 mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 class="font-display text-2xl font-bold">Welcome back</h1>
          <p class="text-sm text-zinc-400 mt-1">Sign in to start creating</p>
        </div>

        <!-- Error -->
        <div v-if="error" class="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {{ error }}
        </div>

        <!-- Form -->
        <form @submit.prevent="handleLogin" class="space-y-5">
          <UFormField label="Email">
            <UInput
              v-model="email"
              type="email"
              placeholder="you@example.com"
              required
              autofocus
              size="lg"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Password">
            <UInput
              v-model="password"
              type="password"
              placeholder="••••••••"
              required
              size="lg"
              class="w-full"
            />
          </UFormField>

          <UButton
            type="submit"
            size="lg"
            :loading="submitting"
            block
          >
            Sign In
          </UButton>
        </form>

        <!-- Divider -->
        <div class="relative my-6">
          <div class="absolute inset-0 flex items-center">
            <div class="w-full border-t border-zinc-800" />
          </div>
          <div class="relative flex justify-center text-xs">
            <span class="px-3 bg-[rgba(15,10,30,0.5)] text-zinc-500">or</span>
          </div>
        </div>

        <!-- Apple Sign In -->
        <UButton
          color="neutral"
          variant="outline"
          size="lg"
          block
          disabled
        >
          <template #leading>
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
            </svg>
          </template>
          Sign in with Apple
        </UButton>

        <!-- Sign up link -->
        <p class="text-center text-sm text-zinc-500 mt-6">
          Don't have an account?
          <NuxtLink to="/signup" class="text-violet-400 hover:text-violet-300 font-medium">
            Create one
          </NuxtLink>
        </p>
      </div>
    </div>
  </div>
</template>
