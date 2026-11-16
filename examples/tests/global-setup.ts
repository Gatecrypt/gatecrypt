import path from 'node:path';
import { run, serve } from '../../dev/dev.mjs';
import { startMockService } from '../../dev/mock-service.mjs';
import { serveStatic } from '../../dev/static-server.mjs';
import { APIS, ELSEWHERE, EXAMPLES_DIR, FRAMEWORKS, PROJECT, SERVICE, available, url } from './env.ts';

/**
 * Starts the mock service, then builds and serves every example: each API
 * with the service's address and the project to accept tokens for, and each
 * framework's site, built against its own API and hosted as plain files.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const closers: (() => Promise<unknown>)[] = [];
  const close = async (): Promise<void> => {
    await Promise.all(closers.map((closer) => closer().catch(() => {})));
  };
  try {
    const service = await startMockService({
      port: Number(new URL(SERVICE).port),
      projectId: PROJECT.id,
      deployToken: PROJECT.deployToken,
      origins: [ELSEWHERE, ...FRAMEWORKS.map((framework) => url(framework.site.port))],
    });
    closers.push(service.close);

    const service_env = { GATECRYPT_PROJECT_ID: PROJECT.id, GATECRYPT_SERVICE_URL: SERVICE };

    // Each example is independent of the others, so they are built side by side.
    await Promise.all([
      ...APIS.filter(available).map(async (api) => {
        const cwd = path.join(EXAMPLES_DIR, api.dir);
        if (api.build) await run('pnpm', ['run', 'build'], { cwd, env: service_env });
        const [command, ...args] = api.start;
        closers.push(
          await serve(command, args, {
            cwd,
            env: { ...service_env, PORT: String(api.port), HOST: 'localhost', NITRO_HOST: 'localhost' },
            ready: `${url(api.port)}/api/me`,
            timeoutMs: 180_000,
          }),
        );
      }),
      ...FRAMEWORKS.map(async ({ site, api }) => {
        const cwd = path.join(EXAMPLES_DIR, site.dir);
        await run('pnpm', ['run', 'build'], {
          cwd,
          env: {
            ...service_env,
            GATECRYPT_DEPLOY_TOKEN: PROJECT.deployToken,
            // Where the site's API is: for the site's own code, and for Gatecrypt, which sends the token there.
            EXAMPLE_API_URL: url(api.port),
            GATECRYPT_API: url(api.port),
          },
        });
        const host = await serveStatic({ dir: path.join(cwd, site.out), port: site.port, redirectIndex: true });
        closers.push(host.close);
      }),
    ]);
  } catch (error) {
    await close();
    throw error;
  }
  return close;
}
