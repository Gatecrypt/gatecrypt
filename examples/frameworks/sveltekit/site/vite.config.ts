import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// A plain static build: every page is prerendered (src/routes/+layout.ts) and adapter-static
// writes build/. `gatecrypt encrypt build` (see package.json) then turns that folder into
// ciphertext and a sign-in page. Gatecrypt's Vite plugin is not used here: SvelteKit writes
// build/ after Vite has finished, so the folder is encrypted afterwards, from the command line.
export default defineConfig({
  plugins: [sveltekit({ adapter: adapter() })],
});
