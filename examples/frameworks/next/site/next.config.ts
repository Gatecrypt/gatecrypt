import type { NextConfig } from 'next';

// A static export: `next build` writes out/, and `gatecrypt encrypt out` (see package.json)
// turns it into ciphertext and a sign-in page. Nothing of Next.js runs on the host.
const config: NextConfig = {
  output: 'export',
};

export default config;
