<script setup lang="ts">
const route = useRoute()
const { user, loggedIn, logout } = useAuth()

const navItems = [
  { label: 'Create', to: '/create', icon: 'i-lucide-sparkles' },
  { label: 'Personas & Scenes', to: '/personas', icon: 'i-lucide-users' },
  { label: 'Gallery', to: '/gallery', icon: 'i-lucide-image' },
  { label: 'Feed', to: '/feed', icon: 'i-lucide-play' },
  { label: 'Settings', to: '/settings', icon: 'i-lucide-settings' },
]

const mobileMenuOpen = ref(false)

watch(route, () => {
  mobileMenuOpen.value = false
})

async function handleLogout() {
  await logout()
  navigateTo('/')
}

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
  link: [{ rel: 'canonical', href: siteUrl }],
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
                <UIcon name="i-lucide-layers" class="w-[18px] h-[18px] text-white" />
              </div>
              <span class="font-display font-bold text-lg tracking-tight text-slate-800 hidden sm:block">AI Media Gen</span>
            </NuxtLink>

            <!-- Desktop nav -->
            <nav class="hidden md:flex items-center gap-1">
              <NuxtLink
                v-for="item in navItems"
                :key="item.to"
                :to="item.to"
                class="px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2"
                :class="route.path === item.to
                  ? 'bg-violet-50 text-violet-700'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'"
              >
                <UIcon :name="item.icon" class="w-4 h-4" />
                {{ item.label }}
              </NuxtLink>
            </nav>

            <!-- Actions -->
            <div class="flex items-center gap-3">
              <div v-if="user" class="flex items-center gap-2">
                <span class="text-sm text-slate-500 hidden sm:block">{{ user.email }}</span>
                <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-log-out" @click="handleLogout" />
              </div>

              <!-- Mobile hamburger -->
              <UButton
                class="md:hidden"
                variant="ghost"
                color="neutral"
                :icon="mobileMenuOpen ? 'i-lucide-x' : 'i-lucide-menu'"
                @click="mobileMenuOpen = !mobileMenuOpen"
              />
            </div>
          </div>

          <!-- Mobile nav -->
          <Transition name="slide-down">
            <nav v-if="mobileMenuOpen" class="md:hidden pb-4 flex flex-col gap-1">
              <NuxtLink
                v-for="item in navItems"
                :key="item.to"
                :to="item.to"
                class="px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-3"
                :class="route.path === item.to
                  ? 'bg-violet-50 text-violet-700'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'"
              >
                <UIcon :name="item.icon" class="w-4 h-4" />
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
        AI Media Gen &middot; 2026
      </footer>
    </div>
  </UApp>
</template>
