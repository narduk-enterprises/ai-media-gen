import posthog from 'posthog-js'

export default defineNuxtPlugin({
  name: 'posthog',
  parallel: true,
  setup(nuxtApp) {
    const config = useRuntimeConfig()
    const key = config.public.posthogKey as string

    if (!key || typeof window === 'undefined') return

    const ph = posthog.init(key, {
      api_host: 'https://us.i.posthog.com',
      person_profiles: 'identified_only',
      capture_pageview: false, // we handle manually for SPA
      capture_pageleave: true,
      loaded: (instance) => {
        if (import.meta.env.DEV) {
          instance.debug()
        }
      }
    })

    if (!ph) return

    // Capture pageviews on route change (SPA-friendly)
    const router = useRouter()
    router.afterEach((to) => {
      nextTick(() => {
        ph.capture('$pageview', {
          $current_url: window.location.origin + to.fullPath
        })
      })
    })

    return {
      provide: {
        posthog: ph
      }
    }
  }
})
