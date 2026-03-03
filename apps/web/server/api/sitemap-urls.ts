/**
 * Dynamic sitemap URLs for AI Media Gen
 */
export default defineEventHandler(() => {
  return [
    { loc: '/', changefreq: 'daily', priority: 1.0 },
    { loc: '/login', changefreq: 'monthly', priority: 0.6 },
    { loc: '/signup', changefreq: 'monthly', priority: 0.6 },
  ]
})
