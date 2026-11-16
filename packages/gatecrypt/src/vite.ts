import path from 'node:path';
import { loadEnv, type Plugin, type ResolvedConfig } from 'vite';
import { protectSite, resolveSettings, summary, type CommonOptions } from './protect.js';

/**
 * The project ID, deploy token and service address may each come from the
 * option, from the environment, or from Vite's env files (`.env.local` and
 * friends) as GATECRYPT_PROJECT_ID, GATECRYPT_DEPLOY_TOKEN and
 * GATECRYPT_SERVICE_URL. So may `api`, as GATECRYPT_API.
 */
export interface GatecryptOptions extends CommonOptions {
  /**
   * Set to false to build without Gatecrypt: the output is the plain,
   * unencrypted site and no deploy token is needed. For builds that are never
   * deployed, such as pull requests from forks, which have no access to the
   * token. Default true.
   */
  enabled?: boolean;
  /**
   * Serve index.html for navigations that match no file, so client-side routes
   * survive a reload. Default: true unless Vite's `appType` is not "spa".
   */
  spaFallback?: boolean;
}

/**
 * Frameworks that drive Vite themselves and write, or finish writing, the
 * folder that gets deployed after Vite's own build is over. Encrypting Vite's
 * output there would protect the wrong folder, or only part of the right one.
 */
const FRAMEWORKS: [RegExp, name: string, output: string][] = [
  [/^vite-plugin-sveltekit/, 'SvelteKit', 'build'],
  [/^astro:|^@astro(js)?\//, 'Astro', 'dist'],
  [/^nuxt:/, 'Nuxt', '.output/public'],
  [/^react-router($|[:/])/, 'React Router', 'build/client'],
  [/^remix$/, 'Remix', 'build/client'],
  [/^vitepress($|:)/, 'VitePress', '.vitepress/dist'],
  [/^vite-plugin-qwik/, 'Qwik', 'dist'],
  [/^tanstack-([a-z]+-)?start/, 'TanStack Start', 'dist/client'],
  [/^solid-start[:-]/, 'SolidStart', '.output/public'],
  [/^vinxi($|:)/, 'Vinxi', '.output/public'],
  [/^@analogjs\/vite-plugin-nitro$/, 'Analog', 'dist/analog/public'],
  [/^vike($|:)/, 'Vike', 'dist/client'],
  [/^waku:/, 'Waku', 'dist/public'],
];

/**
 * Vite plugin: after `vite build`, encrypts the output, registers the build's
 * key with the Gatecrypt service, and writes the sign-in loader and service
 * worker. `vite dev` is unaffected.
 *
 * For plain Vite apps. Frameworks built on Vite (SvelteKit, Astro, Nuxt, ...)
 * are refused with a pointer to the CLI, which works on any finished folder.
 */
export default function gatecrypt(options: GatecryptOptions = {}): Plugin {
  let config: ResolvedConfig;
  let buildFailed = false;
  let settings: CommonOptions = options;
  const enabled = options.enabled ?? true;

  return {
    name: 'gatecrypt',
    apply: 'build',
    enforce: 'post',

    configResolved(resolved) {
      config = resolved;
      if (!enabled) {
        config.logger.warn('gatecrypt: disabled for this build. The output is NOT encrypted; do not deploy it.');
        return;
      }
      for (const plugin of config.plugins) {
        const framework = FRAMEWORKS.find(([pattern]) => pattern.test(plugin.name));
        if (!framework) continue;
        throw new Error(
          `Gatecrypt: this is a ${framework[1]} build, which the Vite plugin cannot protect: ${framework[1]} writes the ` +
            `folder you deploy after Vite has finished. Remove gatecrypt() from the Vite plugins and run ` +
            `"gatecrypt encrypt <folder>" on the finished output (usually ${framework[2]}) after the build.`,
        );
      }
      // Vite's env files as well as the environment, so a token in .env.local works.
      const env = config.envDir === false ? {} : loadEnv(config.mode, config.envDir, 'GATECRYPT_');
      settings = {
        ...options,
        projectId: options.projectId || env.GATECRYPT_PROJECT_ID,
        deployToken: options.deployToken || env.GATECRYPT_DEPLOY_TOKEN,
        serviceUrl: options.serviceUrl || env.GATECRYPT_SERVICE_URL,
        api: options.api ?? (env.GATECRYPT_API || undefined)?.split(',').map((entry) => entry.trim()),
      };
      // Fail now, before anything is built, rather than after the output has been written.
      resolveSettings(settings);
    },

    buildEnd(error) {
      if (error) buildFailed = true;
    },

    closeBundle: {
      order: 'post',
      sequential: true,
      async handler() {
        const environment = (this as { environment?: { name: string } }).environment;
        if (!enabled || buildFailed || config.build.ssr || (environment && environment.name !== 'client')) return;

        const result = await protectSite({
          ...settings,
          dir: path.resolve(config.root, config.build.outDir),
          base: config.base,
          spaFallback: options.spaFallback ?? config.appType === 'spa',
          warn: (message) => config.logger.warn(message),
        });
        config.logger.info(summary(result));
      },
    },
  };
}
