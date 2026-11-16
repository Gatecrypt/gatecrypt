// The browser asks first whether the site may send an Authorization header (a "preflight").
// The answer is in the headers that nuxt.config.ts sets for everything under /api.
export default defineEventHandler((event) => sendNoContent(event));
