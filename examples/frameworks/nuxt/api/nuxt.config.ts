// `nuxt build` makes a Node server (.output/server) in which server/api/me.get.ts runs for each request.
export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  routeRules: {
    // The site is on another origin, and sends an Authorization header: say that both are fine.
    '/api/**': {
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-max-age': '600',
      },
    },
  },
  devtools: { enabled: false },
  telemetry: false,
});
