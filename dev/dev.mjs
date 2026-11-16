/**
 * `pnpm dev`: the demo site, encrypted, on localhost, signing in against a
 * mock of the Gatecrypt service. No account needed.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockService } from './mock-service.mjs';
import { serveStatic } from './static-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEMO_DIR = path.join(ROOT, 'examples/demo');

/** Runs a command to completion; rejects with its output if it fails. */
export function run(command, args, { cwd = ROOT, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, shell: process.platform === 'win32' });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(output) : reject(new Error(`${command} ${args.join(' ')} exited with ${code}\n${output}`)),
    );
  });
}

/**
 * Starts a long-running command. Resolves, once `ready` answers, to a function that stops it.
 * @param {{ cwd: string, env?: Record<string, string>, ready: string, timeoutMs?: number }} options
 *   `ready` is an address that answers (with any status) once the command is up.
 */
export async function serve(command, args, { cwd, env = {}, ready, timeoutMs = 60_000 }) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, shell: process.platform === 'win32' });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  let exited = false;
  child.on('exit', () => (exited = true));
  const stop = () =>
    new Promise((resolve) => {
      if (exited) return resolve();
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (exited) throw new Error(`${command} ${args.join(' ')} exited before it was ready\n${output}`);
    if (await fetch(ready).then(() => true, () => false)) return stop;
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`${command} ${args.join(' ')} was not ready at ${ready} in time\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/**
 * Starts the demo's API (examples/apis/node), which checks visitor tokens against `serviceUrl`.
 * @param {{ port: number, serviceUrl: string, projectId: string }} options
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export async function startDemoApi({ port, serviceUrl, projectId }) {
  const url = `http://localhost:${port}`;
  const close = await serve(process.execPath, ['server.mjs'], {
    cwd: path.join(ROOT, 'examples/apis/node'),
    env: { PORT: String(port), GATECRYPT_SERVICE_URL: serviceUrl, GATECRYPT_PROJECT_ID: projectId },
    ready: `${url}/api/me`,
  });
  return { url, close };
}

/**
 * Builds and encrypts the demo against a running service.
 * @param {{ serviceUrl: string, projectId: string, deployToken: string, outDir?: string, base?: string, demoApiUrl?: string }} options
 *   `demoApiUrl` is the demo's own API (see startDemoApi), if it should call one.
 */
export function buildDemo({ serviceUrl, projectId, deployToken, outDir = 'dist', base = '/', demoApiUrl = '' }) {
  return run('pnpm', ['exec', 'vite', 'build'], {
    cwd: DEMO_DIR,
    env: {
      GATECRYPT_SERVICE_URL: serviceUrl,
      GATECRYPT_PROJECT_ID: projectId,
      GATECRYPT_DEPLOY_TOKEN: deployToken,
      DEMO_OUT_DIR: outDir,
      DEMO_BASE: base,
      VITE_API_URL: demoApiUrl,
    },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const SITE_PORT = 4173;
  const API_PORT = 4174;
  const service = await startMockService({
    port: 8787,
    origins: [`http://localhost:${SITE_PORT}`],
    onCode: ({ email, code }) => console.log(`\n  [code for ${email}] ${code}\n`),
  });
  const { id: projectId, deployToken, allow } = service.project;
  console.log('Building and encrypting the demo site…');
  const api = await startDemoApi({ port: API_PORT, serviceUrl: service.url, projectId });
  await buildDemo({ serviceUrl: service.url, projectId, deployToken, demoApiUrl: api.url });
  const site = await serveStatic({ dir: path.join(DEMO_DIR, 'dist'), port: SITE_PORT, redirectIndex: true });

  console.log(`
Ready.

  Demo site (encrypted)   ${site.url}
      Allowed: ${allow.join(', ')}. Any other address is refused.
      "Continue with Google" opens a mock that believes any address you type.
      Emailed codes are printed here instead of being sent.

  The demo's API          ${api.url}
      examples/apis/node. The "Account" page calls it; it knows who you are from your token.

  Mock service            ${service.url}

  To rebuild the demo with a new key (everyone has to sign in again):
      GATECRYPT_SERVICE_URL=${service.url} GATECRYPT_PROJECT_ID=${projectId} \\
      GATECRYPT_DEPLOY_TOKEN=${deployToken} VITE_API_URL=${api.url} pnpm --filter @gatecrypt/demo build

Press Ctrl+C to stop.`);

  const stop = async () => {
    await Promise.all([site.close(), api.close(), service.close()]);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
