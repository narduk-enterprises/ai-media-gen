<template>
  <div class="text-center py-20">
    <div
      class="w-20 h-20 mx-auto rounded-2xl bg-violet-500/5 border border-violet-500/10 flex items-center justify-center mb-4"
    >
      <UIcon name="i-heroicons-photo" class="w-10 h-10 text-violet-500/30" />
    </div>
    <p class="text-slate-500 mb-4">No creations yet</p>
    <UButton to="/create">
      <template #leading>
        <UIcon name="i-heroicons-sparkles" />
      </template>
      Create your first image
    </UButton>
  </div>
</template>
