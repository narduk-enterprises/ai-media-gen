<script setup lang="ts">
const route = useRoute()
const colorMode = useColorMode()
const { user, loggedIn, logout, loading } = useAuth()

const isDark = computed({
  get: () => colorMode.value === 'dark',
  set: (val: boolean) => { colorMode.preference = val ? 'dark' : 'light' }
})

const navItems = [
  { label: 'Create', to: '/create', icon: 'i-heroicons-sparkles' },
  { label: 'Gallery', to: '/gallery', icon: 'i-heroicons-photo' },
  { label: 'Settings', to: '/settings', icon: 'i-heroicons-cog-6-tooth' },
]

const mobileMenuOpen = ref(false)

watch(route, () => {
  mobileMenuOpen.value = false
})

async function handleLogout() {
  await logout()
  navigateTo('/')
}

/**
 * Global SEO head tags.
 */
const runtimeConfig = useRuntimeConfig()
const siteUrl = runtimeConfig.public.appUrl || 'http://localhost:3000'

useSeoMeta({
  titleTemplate: '%s — AI Media Gen',
  ogSiteName: 'AI Media Gen',
  ogType: 'website',
  ogUrl: siteUrl,
  twitterCard: 'summary_large_image',
})

useHead({
  htmlAttrs: { lang: 'en' },
  link: [
    { rel: 'canonical', href: siteUrl },
  ],
})
</script>

<template>
  <UApp>
    <!-- Aurora background orbs -->
    <div class="aurora-orb" style="width: 600px; height: 600px; background: rgba(139, 92, 246, 0.15); top: -200px; left: -100px;" />
    <div class="aurora-orb" style="width: 500px; height: 500px; background: rgba(6, 182, 212, 0.1); bottom: -200px; right: -100px; animation-delay: -7s;" />

    <div class="min-h-screen flex flex-col">
      <!-- Header (only for logged-in users) -->
      <header v-if="loggedIn" class="glass sticky top-0 z-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex items-center justify-between h-16">
            <!-- Brand -->
            <NuxtLink to="/create" class="flex items-center gap-2.5 group">
              <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-violet-500/20 group-hover:shadow-violet-500/40 transition-shadow">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <span class="font-display font-bold text-lg tracking-tight hidden sm:block">AI Media Gen</span>
            </NuxtLink>

            <!-- Desktop nav -->
            <nav class="hidden md:flex items-center gap-1">
              <NuxtLink
                v-for="item in navItems"
                :key="item.to"
                :to="item.to"
                class="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                :class="route.path === item.to
                  ? 'bg-violet-500/15 text-violet-300'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5'"
              >
                {{ item.label }}
              </NuxtLink>
            </nav>

            <!-- Actions -->
            <div class="flex items-center gap-3">
              <USwitch
                v-model="isDark"
                on-icon="i-heroicons-moon"
                off-icon="i-heroicons-sun"
                size="lg"
              />

              <div v-if="user" class="flex items-center gap-2">
                <span class="text-sm text-zinc-400 hidden sm:block">{{ user.email }}</span>
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  icon="i-heroicons-arrow-right-start-on-rectangle"
                  @click="handleLogout"
                />
              </div>

              <!-- Mobile hamburger -->
              <button class="md:hidden p-2 text-zinc-400 hover:text-white" @click="mobileMenuOpen = !mobileMenuOpen">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <template v-if="!mobileMenuOpen">
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </template>
                  <template v-else>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </template>
                </svg>
              </button>
            </div>
          </div>

          <!-- Mobile nav -->
          <Transition name="slide-down">
            <nav v-if="mobileMenuOpen" class="md:hidden pb-4 flex flex-col gap-1">
              <NuxtLink
                v-for="item in navItems"
                :key="item.to"
                :to="item.to"
                class="px-4 py-3 rounded-lg text-sm font-medium"
                :class="route.path === item.to
                  ? 'bg-violet-500/15 text-violet-300'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5'"
              >
                {{ item.label }}
              </NuxtLink>
            </nav>
          </Transition>
        </div>
      </header>

      <!-- Main content -->
      <main class="flex-1">
        <NuxtPage />
      </main>

      <!-- Footer -->
      <footer v-if="loggedIn" class="text-center py-6 text-xs text-zinc-600">
        AI Media Gen &middot; {{ new Date().getFullYear() }}
      </footer>
    </div>
  </UApp>
</template>



