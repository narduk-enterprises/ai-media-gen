// deploy-trigger: 2026-03-04T20:40:25Z
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pkg from './package.json'

const __dirname = dirname(fileURLToPath(import.meta.url))

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  extends: ['@narduk-enterprises/narduk-nuxt-template-layer'],
  modules: [
    'nitro-cloudflare-dev',
    '@nuxt/ui',
    '@nuxt/image',
    '@nuxt/fonts',
    '@nuxtjs/sitemap',
    '@nuxtjs/robots',
  ],

  css: ['~/assets/css/main.css'],

  devtools: { enabled: true },

  future: {
    compatibilityVersion: 4
  },

  ui: {
    colorMode: false
  },

  image: {
    // Use 'none' provider — serve images directly from /api/media/ without IPX proxy
    // IPX doesn't run on Cloudflare Workers, so we skip server-side image optimization
    provider: 'none',
  },

  vite: {
    define: {
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    optimizeDeps: {
      exclude: ['@mlc-ai/web-llm']
    }
  },

  runtimeConfig: {
    // ComfyUI direct connection (global fallback for all pods)
    comfyUrl: process.env.COMFY_URL || '',
    // Profile-specific pod URLs (optional — override per generation type)
    podImageUrl: process.env.POD_IMAGE_URL || '',
    podVideoUrl: process.env.POD_VIDEO_URL || '',
    webhookSecret: process.env.WEBHOOK_SECRET || '',

    // RunPod API (for pod management)
    runpodApiKey: process.env.RUNPOD_API_KEY || process.env.AI_API_KEY || '',
    // GitHub PAT (for pod bootstrap — cloning private repo)
    githubPat: process.env.GITHUB_PAT || '',

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
    url: process.env.SITE_URL || 'https://ai-media-gen.nard.uk',
    name: 'AI Media Gen',
  },

  sitemap: {
    sources: ['/api/sitemap-urls']
  },

  robots: {
    disallow: ['/api/']
  },



  nitro: {
    cloudflareDev: { configPath: resolve(__dirname, 'wrangler.toml') },
    preset: 'cloudflare-module',
    experimental: {
      tasks: true,
      openAPI: true
    },
    scheduledTasks: {
      '* * * * *': ['recovery:sweep'],
    },
    cloudflare: {
      deployConfig: true,
      nodeCompat: true
    },
    esbuild: {
      options: {
        target: 'esnext'
      }
    },
    externals: {
      inline: ['drizzle-orm'],
      external: ['@mlc-ai/web-llm']
    },
    rollupConfig: {
      external: ['@mlc-ai/web-llm']
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
        { name: 'theme-color', content: '#ffffff' },
      ],
    },
  }
})
