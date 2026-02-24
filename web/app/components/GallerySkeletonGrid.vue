<template>
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
    <UCard v-for="i in 6" :key="i" variant="subtle">
      <template #header>
        <USkeleton class="w-full aspect-video rounded-lg" />
      </template>
      <div class="space-y-2">
        <USkeleton class="h-4 w-3/4" />
        <USkeleton class="h-3 w-1/4" />
      </div>
    </UCard>
  </div>
</template>
