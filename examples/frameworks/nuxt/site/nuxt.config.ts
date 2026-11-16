// A static build: `nuxt generate` writes every page to .output/public as HTML, and
// `gatecrypt encrypt .output/public` (see package.json) turns that into ciphertext and a sign-in page.
export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  runtimeConfig: {
    public: {
      // Where this site's API is (../api). Read when the site is built.
      apiUrl: process.env.EXAMPLE_API_URL ?? 'http://localhost:3001',
    },
  },
  devtools: { enabled: false },
  telemetry: false,
});
