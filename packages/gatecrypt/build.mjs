import { rm } from 'node:fs/promises';
import { build } from 'esbuild';

const browser = { bundle: true, minify: true, target: 'es2022', legalComments: 'none' };
const node = { bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external' };

await rm('dist', { recursive: true, force: true });
await Promise.all([
  // Shipped inside every protected site: inlined into index.html, and copied next to it.
  build({ ...browser, entryPoints: ['src/loader.ts'], outfile: 'dist/loader.js', format: 'iife' }),
  build({ ...browser, entryPoints: ['src/sw.ts'], outfile: 'dist/sw.js', format: 'iife' }),
  // Imported by the protected app itself.
  build({ entryPoints: ['src/client.ts'], outfile: 'dist/client.js', bundle: true, format: 'esm', target: 'es2022' }),
  // Imported by the site's own API, on whatever runs it: no Node built-ins, no dependencies.
  build({ entryPoints: ['src/server.ts'], outfile: 'dist/server.js', bundle: true, format: 'esm', target: 'es2022', platform: 'neutral' }),
  // Build-time API, Vite plugin and CLI.
  build({ ...node, entryPoints: ['src/index.ts', 'src/vite.ts'], outdir: 'dist' }),
  // Run through bin/gatecrypt.js, which is what gets linked as the `gatecrypt` command.
  build({ ...node, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js' }),
]);
