<script setup lang="ts">
const route = useRoute()
const { user, loggedIn, logout } = useAuth()

const navItems = [
  { label: 'Create', to: '/create', icon: 'i-heroicons-sparkles' },
  { label: 'Personas & Scenes', to: '/personas', icon: 'i-heroicons-users' },
  { label: 'Gallery', to: '/gallery', icon: 'i-heroicons-photo' },
  { label: 'Feed', to: '/feed', icon: 'i-heroicons-play' },
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
    <div class="min-h-screen flex flex-col bg-slate-50">
      <!-- Header (only for logged-in users) -->
      <header v-if="loggedIn" class="glass sticky top-0 z-50">
        <div class="max-w-[90rem] mx-auto px-4 sm:px-6 lg:px-8">
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
              <span class="font-display font-bold text-lg tracking-tight text-slate-800 hidden sm:block">AI Media Gen</span>
            </NuxtLink>

            <!-- Desktop nav -->
            <nav class="hidden md:flex items-center gap-1">
              <NuxtLink
                v-for="item in navItems"
                :key="item.to"
                :to="item.to"
                class="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                :class="route.path === item.to
                  ? 'bg-violet-50 text-violet-700'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'"
              >
                {{ item.label }}
              </NuxtLink>
            </nav>

            <!-- Actions -->
            <div class="flex items-center gap-3">
              <div v-if="user" class="flex items-center gap-2">
                <span class="text-sm text-slate-500 hidden sm:block">{{ user.email }}</span>
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  icon="i-heroicons-arrow-right-start-on-rectangle"
                  @click="handleLogout"
                />
              </div>

              <!-- Mobile hamburger -->
              <button class="md:hidden p-2 text-slate-500 hover:text-slate-800" @click="mobileMenuOpen = !mobileMenuOpen">
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
                  ? 'bg-violet-50 text-violet-700'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'"
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
      <footer v-if="loggedIn" class="text-center py-6 text-xs text-slate-400">
        AI Media Gen &middot; {{ new Date().getFullYear() }}
      </footer>
    </div>
  </UApp>
</template>
