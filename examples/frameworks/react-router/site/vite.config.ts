import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';

// Gatecrypt's Vite plugin is not used here: React Router finishes writing build/client after Vite
// is done, so the folder is encrypted afterwards, by the CLI, in the build script.
export default defineConfig({
  plugins: [reactRouter()],
  // Lets the pages read EXAMPLE_API_URL, where this site's API is (../api), as
  // import.meta.env.EXAMPLE_API_URL. It is read when the site is built.
  envPrefix: ['VITE_', 'EXAMPLE_'],
});
