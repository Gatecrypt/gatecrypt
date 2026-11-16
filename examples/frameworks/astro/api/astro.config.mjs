import node from '@astrojs/node';
import { defineConfig } from 'astro/config';

// Server-rendered, so that src/pages/api/me.ts runs for each request.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
});
