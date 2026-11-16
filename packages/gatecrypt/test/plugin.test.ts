import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type InlineConfig, type Plugin } from 'vite';
import { build as build5 } from 'vite5';
import { build as build6 } from 'vite6';
import { build as build7 } from 'vite7';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { b64urlDecode, decryptBlob, importKey, indexAad, parseManifest, type SiteIndex } from '../src/format.js';
import { renderLoaderPage } from '../src/loader-html.js';
import gatecrypt, { type GatecryptOptions } from '../src/vite.js';
import { fakeService, readIndex, readTree, withEnv, type FakeService } from './helpers.js';

const root = fileURLToPath(new URL('./fixture-app', import.meta.url));
type Build = (config: InlineConfig) => Promise<unknown>;
const VITES: [string, Build][] = [
  ['Vite 8', build],
  ['Vite 7', build7 as unknown as Build],
  ['Vite 6', build6 as unknown as Build],
  ['Vite 5', build5 as unknown as Build],
];

let service: FakeService;
beforeEach(async () => {
  service = await fakeService();
});
afterEach(() => service.close());

const tempDir = (): Promise<string> => mkdtemp(path.join(tmpdir(), 'gatecrypt-build-'));

async function buildFixture(
  options: { base?: string; plugin?: GatecryptOptions; plugins?: Plugin[]; vite?: Build; config?: InlineConfig } = {},
) {
  const outDir = await tempDir();
  const run = async () =>
    (options.vite ?? build)({
      root,
      base: options.base,
      logLevel: 'silent',
      configFile: false,
      envDir: false,
      ...options.config,
      build: { outDir, emptyOutDir: true },
      plugins: [
        ...(options.plugins ?? []),
        gatecrypt({ projectId: 'fixture', serviceUrl: service.url, deployToken: 'gcd_test', ...options.plugin }),
      ],
    });
  return { outDir, run, tree: async () => readTree(outDir) };
}

describe.each(VITES)('vite plugin on %s', (_name, vite) => {
  it('turns a real build into ciphertext plus a loader', async () => {
    const fixture = await buildFixture({ vite });
    await fixture.run();
    const tree = await fixture.tree();

    for (const [name, content] of tree) {
      expect(name).not.toMatch(/main|lazy|notes/);
      expect(content.includes('FIXTURE_MARKER'), `${name} contains plaintext`).toBe(false);
    }
    expect(tree.get('CNAME')!.toString().trim()).toBe('fixture.example');
    expect(tree.get('gatecrypt-sw.js')!.length).toBeGreaterThan(500);
    const loader = tree.get('index.html')!.toString();
    expect(loader).toContain('data-base="/"');
    expect(loader).toContain('>Continue with Google</button>');
    expect(tree.get('404.html')!.toString()).toBe(loader);

    // The key the service was given opens the build.
    expect(service.requests).toHaveLength(1);
    const { path: requestPath, authorization, body } = service.requests[0]!;
    expect(requestPath).toBe('/v1/projects/fixture/keys');
    expect(authorization).toBe('Bearer gcd_test');
    const manifest = parseManifest(JSON.parse(tree.get('gatecrypt.json')!.toString()));
    expect(manifest).toMatchObject({ projectId: 'fixture', keyId: body.keyId, service: service.url });
    const key = await importKey(b64urlDecode(body.key), ['decrypt']);
    const index = JSON.parse(
      Buffer.from(await decryptBlob(key, new Uint8Array(tree.get(manifest.index)!), indexAad(manifest.keyId))).toString(),
    ) as SiteIndex;
    const files = Object.keys(index.files);
    expect(files).toContain('index.html');
    expect(files).toContain('notes.txt');
    expect(files.filter((f) => /^assets\/.+\.js$/.test(f)).length).toBeGreaterThanOrEqual(2); // entry + lazy chunk
    expect(index.fallback).toBe('index.html');
  });

  it('fails the build and leaves nothing deployable when the key is rejected', async () => {
    service.statuses = [401];
    const fixture = await buildFixture({ vite, plugin: { deployToken: 'gcd_bad' } });
    await expect(fixture.run()).rejects.toThrow('could not register the build key');
    expect((await fixture.tree()).size).toBe(0);
  });
});

describe('vite plugin', () => {
  it('bakes an absolute base into the loader', async () => {
    const fixture = await buildFixture({ base: '/my-repo/' });
    await fixture.run();
    const tree = await fixture.tree();
    expect(tree.get('index.html')!.toString()).toContain('data-base="/my-repo/"');
    expect(tree.has('404.html')).toBe(true);
  });

  it('uses a relative base without a 404 page', async () => {
    const fixture = await buildFixture({ base: './' });
    await fixture.run();
    const tree = await fixture.tree();
    expect(tree.get('index.html')!.toString()).toContain('data-base="./"');
    expect(tree.has('404.html')).toBe(false);
  });

  it('fails before building anything when there is no deploy token or project ID', async () => {
    await withEnv({ GATECRYPT_DEPLOY_TOKEN: undefined, GATECRYPT_PROJECT_ID: undefined }, async () => {
      const noToken = await buildFixture({ plugin: { deployToken: undefined } });
      await expect(noToken.run()).rejects.toThrow('GATECRYPT_DEPLOY_TOKEN');
      expect(await readdir(noToken.outDir)).toEqual([]);

      const noProject = await buildFixture({ plugin: { projectId: undefined } });
      await expect(noProject.run()).rejects.toThrow('GATECRYPT_PROJECT_ID');
      expect(await readdir(noProject.outDir)).toEqual([]);
    });
    expect(service.requests).toEqual([]);
  });

  it('takes the project ID, token and service from the environment', async () => {
    await withEnv(
      { GATECRYPT_PROJECT_ID: 'from-env', GATECRYPT_DEPLOY_TOKEN: 'gcd_env', GATECRYPT_SERVICE_URL: service.url },
      async () => {
        const fixture = await buildFixture({ plugin: { projectId: undefined, deployToken: undefined, serviceUrl: undefined } });
        await fixture.run();
      },
    );
    expect(service.requests).toMatchObject([{ path: '/v1/projects/from-env/keys', authorization: 'Bearer gcd_env' }]);
  });

  it("takes them from Vite's env files too, such as .env.local", async () => {
    const envDir = await tempDir();
    await writeFile(path.join(envDir, '.env.local'), 'GATECRYPT_DEPLOY_TOKEN=gcd_file\nGATECRYPT_PROJECT_ID=from-file\n');
    await withEnv({ GATECRYPT_PROJECT_ID: undefined, GATECRYPT_DEPLOY_TOKEN: undefined }, async () => {
      const fixture = await buildFixture({ plugin: { projectId: undefined, deployToken: undefined }, config: { envDir } });
      await fixture.run();
    });
    expect(service.requests).toMatchObject([{ path: '/v1/projects/from-file/keys', authorization: 'Bearer gcd_file' }]);
  });

  it('builds the plain site, and calls nobody, when disabled', async () => {
    const fixture = await withEnv({ GATECRYPT_DEPLOY_TOKEN: undefined }, async () => {
      const fixture = await buildFixture({ plugin: { enabled: false, deployToken: undefined } });
      await fixture.run();
      return fixture;
    });
    const tree = await fixture.tree();
    expect(tree.has('gatecrypt.json')).toBe(false);
    expect(tree.get('index.html')!.toString()).toContain('<script');
    expect([...tree.values()].some((content) => content.includes('FIXTURE_MARKER'))).toBe(true);
    expect(service.requests).toEqual([]);
  });

  it.each([
    ['vite-plugin-sveltekit-compile', 'SvelteKit'],
    ['astro:build', 'Astro'],
    ['@astrojs/vite-plugin-astro-adapter', 'Astro'],
    ['nuxt:client-manifest', 'Nuxt'],
    ['react-router', 'React Router'],
    ['react-router:virtual-modules', 'React Router'],
    ['remix', 'Remix'],
    ['vitepress', 'VitePress'],
    ['vite-plugin-qwik-city', 'Qwik'],
    ['tanstack-react-start:config', 'TanStack Start'],
    ['tanstack-start-core:post-build', 'TanStack Start'],
    ['solid-start:config', 'SolidStart'],
    ['vinxi:manifest', 'Vinxi'],
    ['@analogjs/vite-plugin-nitro', 'Analog'],
    ['vike:build:pluginBuildApp', 'Vike'],
    ['waku:vite-plugins:static-build', 'Waku'],
  ])('refuses a build driven by %s, which writes its output after Vite is done', async (name, framework) => {
    const fixture = await buildFixture({ plugins: [{ name }] });
    await expect(fixture.run()).rejects.toThrow(`this is a ${framework} build`);
    await expect(fixture.run()).rejects.toThrow('gatecrypt encrypt');
    expect(await readdir(fixture.outDir)).toEqual([]);
    expect(service.requests).toEqual([]);
  });

  it.each([
    'vite:react-babel',
    'vite:vue',
    'vite-plugin-pwa',
    'vite-tsconfig-paths',
    'unplugin-icons',
    'react-router-devtools-like',
    'remixicon',
    'vite-plugin-svelte',
    'solid',
    'tanstack-router',
    '@analogjs/vite-plugin-angular',
    'astronomy',
  ])('does not mistake the ordinary plugin %s for a framework', async (name) => {
    const fixture = await buildFixture({ plugins: [{ name }] });
    await fixture.run();
    expect((await fixture.tree()).has('gatecrypt.json')).toBe(true);
  });

  it('translates and rewords the sign-in page', async () => {
    const fixture = await buildFixture({
      plugin: { lang: 'de', title: 'Nur für Mitglieder', text: { google: 'Weiter mit Google', codeSent: 'Code an {email} gesendet.' } },
    });
    await fixture.run();
    const loader = (await fixture.tree()).get('index.html')!.toString();
    expect(loader).toContain('<html lang="de">');
    expect(loader).toContain('<title>Nur für Mitglieder</title>');
    expect(loader).toContain('>Weiter mit Google</button>');
    expect(loader).toContain('>Email me a code</button>'); // not replaced: stays English
    expect(loader).toContain('data-text="{&#34;google&#34;:&#34;Weiter mit Google&#34;');

    const unknown = await buildFixture({ plugin: { text: { gogle: 'x' } as never } });
    await expect(unknown.run()).rejects.toThrow('text.gogle is not a sentence of the sign-in page');
    const badLang = await buildFixture({ plugin: { lang: '"><script>' } });
    await expect(badLang.run()).rejects.toThrow('lang must be a language tag');
  });

  it('records where the site\'s API is, and refuses one a token should not be sent to', async () => {
    const fixture = await buildFixture({ plugin: { api: 'https://api.example.com/v2/' } });
    await fixture.run();
    expect((await readIndex(await fixture.tree(), service.requests[0]!.body.key)).api).toEqual(['https://api.example.com/v2/']);

    const insecure = await buildFixture({ plugin: { api: ['/api', 'http://api.example.com'] } });
    await expect(insecure.run()).rejects.toThrow('must be https');
    expect(service.requests).toHaveLength(1);
  });

  it('says so when the project has no site address yet', async () => {
    service.project = { name: 'Fixture', origins: [] };
    const warnings: string[] = [];
    const fixture = await buildFixture({
      config: {
        logLevel: 'warn',
        customLogger: {
          info: () => {},
          warn: (message: string) => warnings.push(message),
          warnOnce: () => {},
          error: () => {},
          clearScreen: () => {},
          hasErrorLogged: () => false,
          hasWarned: false,
        },
      },
    });
    await fixture.run();
    expect(warnings.join('\n')).toContain('no site address yet');
  });
});

describe('renderLoaderPage', () => {
  it('escapes its inputs and cannot be closed early by the script', () => {
    const html = renderLoaderPage({
      base: '/a"b/',
      lang: 'en',
      text: { title: '<Team> & "friends"', google: '</button><script>alert(1)</script>' },
      loaderJs: 'var s="</script><script>alert(1)</script>";',
    });
    expect(html).not.toContain('<Team>');
    expect(html).not.toContain('data-base="/a"b/"');
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).not.toContain('</button><script>');
  });
});
