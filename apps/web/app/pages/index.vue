<script setup lang="ts">
const { loggedIn } = useAuth()

onMounted(() => {
  if (loggedIn.value) {
    navigateTo('/create', { replace: true })
  }
})

useSeoMeta({
  title: 'AI Media Gen — Generate Images, Videos & Audio with AI',
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
    <!-- Ambient gradient orbs -->
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
      <div class="absolute top-1/4 -left-32 w-96 h-96 rounded-full bg-violet-500/8 blur-3xl animate-float-orb" />
      <div class="absolute bottom-1/4 -right-32 w-80 h-80 rounded-full bg-cyan-500/8 blur-3xl animate-float-orb" style="animation-delay: -4s;" />
      <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-violet-500/3 blur-3xl" />
    </div>

    <div class="text-center max-w-2xl relative z-10">
      <!-- Logo -->
      <div class="flex justify-center mb-8 animate-enter">
        <div class="w-20 h-20 rounded-2xl bg-linear-to-br from-violet-500 via-purple-500 to-cyan-500 flex items-center justify-center shadow-2xl shadow-violet-500/30 animate-gradient glow-brand">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
      </div>

      <h1 class="font-display text-5xl sm:text-6xl font-black tracking-tight mb-4 animate-enter animate-enter-delay-1">
        <span class="text-transparent bg-clip-text bg-linear-to-r from-violet-400 via-purple-400 to-cyan-400">
          AI Media Gen
        </span>
      </h1>
      <p class="text-lg sm:text-xl text-white/50 mb-10 max-w-lg mx-auto leading-relaxed animate-enter animate-enter-delay-2">
        Type a prompt. Get stunning images, videos, and audio — powered by cutting-edge generative AI.
      </p>

      <div class="flex flex-col sm:flex-row items-center justify-center gap-4 animate-enter animate-enter-delay-3">
        <UButton
          to="/login"
          size="xl"
          class="min-w-[200px]"
        >
          <template #leading>
            <UIcon name="i-lucide-sparkles" />
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

      <!-- Feature pills (SVG icons, no emojis) -->
      <div class="mt-16 flex flex-wrap justify-center gap-3 animate-enter animate-enter-delay-4">
        <span class="px-4 py-2 rounded-full text-xs font-medium bg-violet-500/10 text-violet-300 border border-violet-500/20 flex items-center gap-2">
          <UIcon name="i-lucide-palette" class="w-3.5 h-3.5" />
          Text → Image
        </span>
        <span class="px-4 py-2 rounded-full text-xs font-medium bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 flex items-center gap-2">
          <UIcon name="i-lucide-film" class="w-3.5 h-3.5" />
          Image → Video
        </span>
        <span class="px-4 py-2 rounded-full text-xs font-medium bg-pink-500/10 text-pink-300 border border-pink-500/20 flex items-center gap-2">
          <UIcon name="i-lucide-music" class="w-3.5 h-3.5" />
          Add Audio
        </span>
        <span class="px-4 py-2 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 flex items-center gap-2">
          <UIcon name="i-lucide-zap" class="w-3.5 h-3.5" />
          1–16 images per prompt
        </span>
      </div>
    </div>
  </div>
</template>
