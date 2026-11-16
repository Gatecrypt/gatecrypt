/**
 * What the example tests run: one mock service, every example API, and every
 * framework's site next to its API.
 *
 *   EXAMPLES=next,python pnpm test:examples     only some of them
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXAMPLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The mock service. EXAMPLES_SERVICE_PORT moves it, so that two runs can share a machine. */
export const SERVICE = `http://localhost:${process.env.EXAMPLES_SERVICE_PORT ?? 9888}`;
export const PROJECT = { id: 'examples', deployToken: 'gcd_mock' };
/** In every site's source, and so in none of the files it deploys. */
export const MARKER = 'GATECRYPT_EXAMPLE_MARKER';
/** A site address of the project that no example is served from: where browserless visitors "are". */
export const ELSEWHERE = 'http://localhost:4400';

export interface Api {
  name: string;
  /** Folder, under examples/. */
  dir: string;
  port: number;
  /** `pnpm run build` first. */
  build?: boolean;
  /** The command that serves it. It is given PORT, GATECRYPT_PROJECT_ID and GATECRYPT_SERVICE_URL. */
  start: [command: string, ...args: string[]];
  /** Tools that must be on the PATH. Without them the example is skipped, except in CI. */
  needs?: string;
}

export interface Framework {
  name: string;
  title: string;
  site: { dir: string; port: number; /** The folder `pnpm run build` leaves the encrypted site in. */ out: string };
  api: Api;
}

const frameworkApi = (name: string, port: number, start: Api['start']): Api => ({
  name: `${name} (framework)`,
  dir: `frameworks/${name}/api`,
  port,
  build: true,
  start,
});

const ALL_FRAMEWORKS: Framework[] = [
  {
    name: 'next',
    title: 'Next.js',
    site: { dir: 'frameworks/next/site', port: 4411, out: 'out' },
    api: frameworkApi('next', 4421, ['pnpm', 'run', 'start']),
  },
  {
    name: 'react-router',
    title: 'React Router (Remix)',
    site: { dir: 'frameworks/react-router/site', port: 4412, out: 'build/client' },
    api: frameworkApi('react-router', 4422, ['pnpm', 'run', 'start']),
  },
  {
    name: 'astro',
    title: 'Astro',
    site: { dir: 'frameworks/astro/site', port: 4413, out: 'dist' },
    api: frameworkApi('astro', 4423, ['pnpm', 'run', 'start']),
  },
  {
    name: 'sveltekit',
    title: 'SvelteKit',
    site: { dir: 'frameworks/sveltekit/site', port: 4414, out: 'build' },
    api: frameworkApi('sveltekit', 4424, ['pnpm', 'run', 'start']),
  },
  {
    name: 'nuxt',
    title: 'Nuxt',
    site: { dir: 'frameworks/nuxt/site', port: 4415, out: '.output/public' },
    api: frameworkApi('nuxt', 4425, ['pnpm', 'run', 'start']),
  },
];

const PLAIN_APIS: Api[] = [
  { name: 'node', dir: 'apis/node', port: 4431, start: ['node', 'server.mjs'] },
  { name: 'jose', dir: 'apis/jose', port: 4432, start: ['node', 'server.mjs'] },
  { name: 'python', dir: 'apis/python', port: 4433, start: ['uv', 'run', 'server.py'], needs: 'uv' },
];

const only = process.env.EXAMPLES?.split(',').map((name) => name.trim()).filter(Boolean);
const wanted = (name: string): boolean => !only || only.includes(name);

export const FRAMEWORKS = ALL_FRAMEWORKS.filter((framework) => wanted(framework.name));
export const APIS = [...PLAIN_APIS.filter((api) => wanted(api.name)), ...FRAMEWORKS.map((framework) => framework.api)];

export const url = (port: number): string => `http://localhost:${port}`;

const onPath = (tool: string): boolean => {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [tool], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/** Whether an example can run here. In CI every one must. */
export function available(api: Api): boolean {
  if (!api.needs || onPath(api.needs)) return true;
  if (process.env.CI) throw new Error(`The ${api.name} example needs "${api.needs}" on the PATH.`);
  return false;
}
