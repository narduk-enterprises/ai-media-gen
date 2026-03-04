<script setup lang="ts">
const { signup, loggedIn } = useAuth()

if (loggedIn.value) {
  navigateTo('/create')
}

useSeo({
  title: 'Create Account',
  description: 'Join AI Media Gen to start generating images and videos with AI.'
})
useWebPageSchema({ type: 'ContactPage' })

const name = ref('')
const email = ref('')
const password = ref('')
const error = ref('')
const submitting = ref(false)

async function handleSignup() {
  error.value = ''
  submitting.value = true

  try {
    await signup(email.value, password.value, name.value || undefined)
    navigateTo('/create')
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }; message?: string }
    error.value = err.data?.message || err.message || 'Signup failed'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4">
    <div class="w-full max-w-md">
      <!-- Back link -->
      <NuxtLink to="/" class="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-8 transition-colors">
        <UIcon name="i-lucide-arrow-left" class="w-4 h-4" />
        Back
      </NuxtLink>

      <div class="glass-card p-8">
        <!-- Header -->
        <div class="text-center mb-8">
          <div class="w-14 h-14 mx-auto rounded-xl bg-linear-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-violet-500/20 mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 class="font-display text-2xl font-bold text-slate-800">Create your account</h1>
          <p class="text-sm text-slate-500 mt-1">Start generating with AI</p>
        </div>

        <!-- Error -->
        <div v-if="error" class="mb-6 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
          {{ error }}
        </div>

        <!-- Form -->
        <UForm :state="{ email, password, name }" @submit="handleSignup" class="space-y-5">
          <UFormField label="Name (optional)" name="name">
            <UInput
              v-model="name"
              type="text"
              placeholder="Your name"
              size="lg"
              class="w-full"
              autofocus
            />
          </UFormField>

          <UFormField label="Email" name="email">
            <UInput
              v-model="email"
              type="email"
              placeholder="you@example.com"
              required
              size="lg"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Password" name="password">
            <UInput
              v-model="password"
              type="password"
              placeholder="Minimum 8 characters"
              required
              minlength="8"
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
            Create Account
          </UButton>
        </UForm>

        <!-- Sign in link -->
        <p class="text-center text-sm text-slate-500 mt-6">
          Already have an account?
          <NuxtLink to="/login" class="text-violet-600 hover:text-violet-700 font-medium">
            Sign in
          </NuxtLink>
        </p>
      </div>
    </div>
  </div>
</template>
