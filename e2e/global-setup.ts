import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DEMO_DIR, buildDemo, startDemoApi } from '../dev/dev.mjs';
import { startMockService } from '../dev/mock-service.mjs';
import { serveStatic } from '../dev/static-server.mjs';
import { CLI_MARKER, CLI_SITE, DEMO_API, GERMAN, OUT_DIR, PROJECT, SERVICE, SITE, SUBPATH_OUT_DIR, SUBPATH_SITE, UNREGISTERED_SITE } from './env.ts';

const CLI = fileURLToPath(new URL('../packages/gatecrypt/dist/cli.js', import.meta.url));
const port = (url: string): number => Number(new URL(url).port);

/**
 * Starts the mock service, builds the demo twice with the Vite plugin and a
 * small plain site with the CLI, and hosts them the way a static host would.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const closers: (() => Promise<unknown>)[] = [];
  const close = async (): Promise<void> => {
    for (const closer of closers.reverse()) await closer().catch(() => {});
  };
  try {
    const service = await startMockService({
      port: port(SERVICE),
      projectId: PROJECT.id,
      deployToken: PROJECT.deployToken,
      origins: [SITE, SUBPATH_SITE, CLI_SITE].map((url) => new URL(url).origin),
    });
    closers.push(service.close);

    const api = await startDemoApi({ port: port(DEMO_API), serviceUrl: SERVICE, projectId: PROJECT.id });
    closers.push(api.close);

    const build = { serviceUrl: SERVICE, projectId: PROJECT.id, deployToken: PROJECT.deployToken, demoApiUrl: DEMO_API };
    await buildDemo({ ...build, outDir: OUT_DIR });
    await buildDemo({ ...build, outDir: SUBPATH_OUT_DIR, base: new URL(SUBPATH_SITE).pathname });

    const work = await mkdtemp(path.join(tmpdir(), 'gatecrypt-e2e-'));
    closers.push(() => rm(work, { recursive: true, force: true }));
    const plain = path.join(work, 'site');
    await mkdir(path.join(plain, 'docs'), { recursive: true });
    await writeFile(path.join(plain, 'index.html'), `<!doctype html><title>Start</title><h1>Start ${CLI_MARKER}</h1><a href="about">About</a> <a href="docs/">Docs</a>`);
    await writeFile(path.join(plain, 'about.html'), `<!doctype html><title>About</title><h1>About ${CLI_MARKER}</h1>`);
    await writeFile(path.join(plain, 'docs/index.html'), `<!doctype html><title>Docs</title><h1>Docs ${CLI_MARKER}</h1>`);
    await writeFile(path.join(plain, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
    await writeFile(path.join(work, 'de.json'), JSON.stringify(GERMAN));
    await promisify(execFile)(
      process.execPath,
      [CLI, 'encrypt', plain, '--lang', 'de', '--text', path.join(work, 'de.json'), '--no-spa-fallback', '--passthrough', 'robots.txt'],
      { env: { ...process.env, GATECRYPT_PROJECT_ID: PROJECT.id, GATECRYPT_DEPLOY_TOKEN: PROJECT.deployToken, GATECRYPT_SERVICE_URL: SERVICE } },
    );

    const host = async (dir: string, url: string): Promise<void> => {
      const site = await serveStatic({ dir, port: port(url), mount: new URL(url).pathname, redirectIndex: true });
      closers.push(site.close);
    };
    await host(path.join(DEMO_DIR, OUT_DIR), SITE);
    await host(path.join(DEMO_DIR, OUT_DIR), UNREGISTERED_SITE);
    await host(path.join(DEMO_DIR, SUBPATH_OUT_DIR), SUBPATH_SITE);
    await host(plain, CLI_SITE);
  } catch (error) {
    await close();
    throw error;
  }
  return close;
}
