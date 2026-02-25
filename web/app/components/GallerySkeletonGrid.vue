<script setup lang="ts">
const props = withDefaults(defineProps<{
  count?: number
  large?: boolean
}>(), {
  count: 12,
  large: true,
})

// Generate random aspect ratios once to avoid layout shifts
const aspectRatios = computed(() =>
  Array.from({ length: props.count }, () => {
    const ratios = ['aspect-square', 'aspect-3/4', 'aspect-4/5', 'aspect-4/3', 'aspect-3/2']
    return ratios[Math.floor(Math.random() * ratios.length)]
  })
)
</script>

<template>
  <div :class="['columns-2', large ? 'sm:columns-3 lg:columns-4 gap-4' : 'sm:columns-4 lg:columns-5 xl:columns-6 gap-3']">
    <div
      v-for="i in count"
      :key="i"
      :class="['break-inside-avoid rounded-xl overflow-hidden border border-slate-200 bg-slate-100', large ? 'mb-4' : 'mb-3']"
    >
      <USkeleton :class="['w-full', aspectRatios[i - 1]]" />
    </div>
  </div>
</template>
