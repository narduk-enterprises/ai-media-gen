<script setup lang="ts">
const { loggedIn } = useAuth()

// If logged in, go straight to /create
if (loggedIn.value) {
  await navigateTo('/create', { replace: true })
}

useSeoMeta({
  title: 'AI Media Gen — Generate Images, Videos & Audio with AI',
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
    <div class="text-center max-w-2xl relative z-10">
      <!-- Logo -->
      <div class="flex justify-center mb-8">
        <div class="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500 via-purple-500 to-cyan-500 flex items-center justify-center shadow-2xl shadow-violet-500/30 animate-gradient">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
      </div>

      <h1 class="font-display text-5xl sm:text-6xl font-black tracking-tight mb-4">
        <span class="text-transparent bg-clip-text bg-gradient-to-r from-violet-600 via-purple-500 to-cyan-600">
          AI Media Gen
        </span>
      </h1>
      <p class="text-lg sm:text-xl text-slate-500 mb-10 max-w-lg mx-auto leading-relaxed">
        Type a prompt. Get stunning images, videos, and audio — powered by cutting-edge generative AI.
      </p>

      <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
        <UButton
          to="/login"
          size="xl"
          class="min-w-[200px]"
        >
          <template #leading>
            <UIcon name="i-heroicons-sparkles" />
          </template>
          Get Started
        </UButton>

        <UButton
          to="/signup"
          size="xl"
          variant="outline"
          color="neutral"
          class="min-w-[200px]"
        >
          Create Account
        </UButton>
      </div>

      <!-- Feature pills -->
      <div class="mt-16 flex flex-wrap justify-center gap-3">
        <span class="px-4 py-2 rounded-full text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200">
          🎨 Text → Image
        </span>
        <span class="px-4 py-2 rounded-full text-xs font-medium bg-cyan-50 text-cyan-700 border border-cyan-200">
          🎬 Image → Video
        </span>
        <span class="px-4 py-2 rounded-full text-xs font-medium bg-pink-50 text-pink-700 border border-pink-200">
          🔊 Add Audio
        </span>
        <span class="px-4 py-2 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          ⚡ 1–16 images per prompt
        </span>
      </div>
    </div>
  </div>
</template>
