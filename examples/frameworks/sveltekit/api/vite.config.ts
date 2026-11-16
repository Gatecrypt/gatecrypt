import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// A Node server, so that src/routes/api/me/+server.ts runs for each request: `node build`.
export default defineConfig({
  plugins: [sveltekit({ adapter: adapter() })],
});
