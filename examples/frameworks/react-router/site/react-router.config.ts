import type { Config } from '@react-router/dev/config';

// SPA mode: no server. `react-router build` writes plain files to build/client, with one index.html
// for every address, and `gatecrypt encrypt build/client` (see package.json) turns them into
// ciphertext and a sign-in page.
export default {
  ssr: false,
} satisfies Config;
