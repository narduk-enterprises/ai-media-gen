<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useSeoMeta({ title: 'Personas & Scenes' })
</script>

<template>
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <div class="mb-8">
      <h1 class="text-2xl font-display font-bold text-slate-800 tracking-tight">
        Personas & Scenes
      </h1>
      <p class="text-sm text-slate-500 mt-1">
        Define your characters and scenes here. Combine them on the Create page to generate images.
      </p>
    </div>

    <ClientOnly>
      <PersonaManager />
      <SceneManager />
      <template #fallback>
        <div class="flex items-center justify-center py-20 text-slate-400"><UIcon name="i-lucide-loader-2" class="animate-spin mr-2" /> Loading...</div>
      </template>
    </ClientOnly>
  </div>
</template>
