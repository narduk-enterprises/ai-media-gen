import pkg from './package.json'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/ui',
    '@nuxt/fonts',
    '@nuxtjs/sitemap',
    '@nuxtjs/robots'
  ],
  css: ['~/assets/css/main.css'],

  compatibilityDate: '2025-07-15',

  devtools: { enabled: true },

  future: {
    compatibilityVersion: 4
  },

  ui: {
    colorMode: true
  },

  colorMode: {
    preference: 'dark'
  },

  vite: {
    define: {
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
      __APP_VERSION__: JSON.stringify(pkg.version)
    }
  },

  runtimeConfig: {
    // AI generation API (RunPod / Replicate / Fal.ai)
    aiApiKey: process.env.AI_API_KEY || '',
    aiApiUrl: process.env.AI_API_URL || '',

    // Apple Sign-In
    appleTeamId: process.env.APPLE_TEAM_ID || '',
    appleClientId: process.env.APPLE_CLIENT_ID || '',
    appleKeyId: process.env.APPLE_KEY_ID || '',
    appleSecretKey: process.env.APPLE_SECRET_KEY || '',

    public: {
      appUrl: process.env.SITE_URL || 'http://localhost:3000',
      posthogPublicKey: process.env.POSTHOG_PUBLIC_KEY || '',
      posthogHost: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
      gaMeasurementId: process.env.GA_MEASUREMENT_ID || '',
      appName: process.env.APP_NAME || pkg.name || 'AI Media Gen'
    }
  },

  site: {
    url: process.env.SITE_URL || 'http://localhost:3000',
    name: 'AI Media Gen'
  },

  sitemap: {
    sources: ['/api/sitemap-urls']
  },

  robots: {
    disallow: ['/api/']
  },

  nitro: {
    preset: 'cloudflare_module',
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
      wrangler: {
        name: 'ai-media-gen',
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'ai-media-gen-db',
            database_id: '9a1de542-1861-4a4c-a456-7367915c2dee'
          }
        ]
      }
    },
    esbuild: {
      options: {
        target: 'esnext'
      }
    },
    externals: {
      inline: ['drizzle-orm']
    }
  },

  app: {
    head: {
      title: 'AI Media Gen — Create Images, Videos & Audio with AI',
      htmlAttrs: { lang: 'en' },
      meta: [
        { name: 'description', content: 'Generate stunning AI images, videos, and audio. Type a prompt, get results instantly. Powered by cutting-edge generative AI.' },
        { name: 'keywords', content: 'ai image generator, text to image, image to video, ai art, generative ai' },
        { property: 'og:title', content: 'AI Media Gen — Create Images, Videos & Audio with AI' },
        { property: 'og:description', content: 'Generate stunning AI images, videos, and audio. Type a prompt, get results instantly.' },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'AI Media Gen' },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: 'AI Media Gen — Create Images, Videos & Audio with AI' },
        { name: 'twitter:description', content: 'Generate stunning AI images, videos, and audio. Type a prompt, get results instantly.' },
        { name: 'theme-color', content: '#0c0a1a' },
      ],
    },
    pageTransition: { name: 'page', mode: 'out-in' }
  }
})
