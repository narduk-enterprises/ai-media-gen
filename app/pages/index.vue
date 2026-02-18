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
    <!-- Background decoration -->
    <div class="aurora-orb" style="width: 500px; height: 500px; background: rgba(139, 92, 246, 0.12); top: 10%; left: 20%;" />
    <div class="aurora-orb" style="width: 400px; height: 400px; background: rgba(6, 182, 212, 0.08); bottom: 10%; right: 20%; animation-delay: -5s;" />

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
        <span class="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 via-purple-300 to-cyan-400">
          AI Media Gen
        </span>
      </h1>
      <p class="text-lg sm:text-xl text-zinc-400 mb-10 max-w-lg mx-auto leading-relaxed">
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
        <span class="px-4 py-2 rounded-full text-xs font-medium bg-violet-500/10 text-violet-300 border border-violet-500/20">
          🎨 Text → Image
        </span>
        <span class="px-4 py-2 rounded-full text-xs font-medium bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
          🎬 Image → Video
        </span>
        <span class="px-4 py-2 rounded-full text-xs font-medium bg-pink-500/10 text-pink-300 border border-pink-500/20">
          🔊 Add Audio
        </span>
        <span class="px-4 py-2 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
          ⚡ 1–16 images per prompt
        </span>
      </div>
    </div>
  </div>
</template>
