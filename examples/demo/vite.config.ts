import gatecrypt from 'gatecrypt/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `vite dev` serves the app as usual. `vite build` encrypts the output and
// registers the build's key, using GATECRYPT_DEPLOY_TOKEN from the environment.
export default defineConfig({
  // Set DEMO_BASE=/some/path/ to try a site that does not live at the root of its host.
  base: process.env.DEMO_BASE ?? '/',
  build: { outDir: process.env.DEMO_OUT_DIR ?? 'dist' },
  plugins: [
    react(),
    gatecrypt({
      // In your own site: projectId: 'YOUR_PROJECT_ID', from the dashboard. The demo leaves it to
      // the GATECRYPT_PROJECT_ID and GATECRYPT_SERVICE_URL environment variables, so that
      // `pnpm dev` and the tests can point it at a local service.
      title: 'Sign in to continue',
      // The site's own API (examples/apis/node), if there is one: calls to it carry the visitor's
      // token. In your own site: api: 'https://api.example.com'.
      api: process.env.VITE_API_URL || undefined,
    }),
  ],
});
