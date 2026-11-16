import { execFile } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VERSION } from '../src/version.js';
import { fakeService, makeSite, readIndex, readTree, type FakeService } from './helpers.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const run = (args: string[], env: Record<string, string> = {}) =>
  promisify(execFile)(process.execPath, [cli, ...args], {
    env: { PATH: process.env.PATH ?? '', GATECRYPT_DEPLOY_TOKEN: 'gcd_cli', ...env },
  });

let service: FakeService;
beforeEach(async () => {
  service = await fakeService();
});
afterEach(() => service.close());

describe('gatecrypt CLI', () => {
  it('encrypts a directory in place and registers the key', async () => {
    const dir = await makeSite({ 'index.html': '<p>CLI_MARKER</p>', 'docs/guide.html': 'CLI_MARKER guide', 'CNAME': 'x.test' });
    const { stdout } = await run(['encrypt', dir, '--project', 'proj', '--service', service.url, '--base', '/docs', '--title', 'Members only']);
    expect(stdout).toContain('encrypted 2 files for "Fixture", served at https://fixture.example');

    const tree = await readTree(dir);
    for (const [name, content] of tree) expect(content.includes('CLI_MARKER'), name).toBe(false);
    expect(tree.get('CNAME')!.toString()).toBe('x.test');
    const loader = tree.get('index.html')!.toString();
    expect(loader).toContain('data-base="/docs/"'); // trailing slash added
    expect(loader).toContain('Members only');
    expect(service.requests).toHaveLength(1);
    expect(service.requests[0]).toMatchObject({ path: '/v1/projects/proj/keys', authorization: 'Bearer gcd_cli' });
  });

  it('takes the project and the service from the environment', async () => {
    const dir = await makeSite({ 'index.html': 'home' });
    await run(['encrypt', dir], { GATECRYPT_PROJECT_ID: 'env-proj', GATECRYPT_SERVICE_URL: service.url });
    expect(service.requests).toMatchObject([{ path: '/v1/projects/env-proj/keys' }]);
  });

  it('honours --passthrough and --no-spa-fallback', async () => {
    const dir = await makeSite({ 'index.html': 'home', 'robots.txt': 'User-agent: *' });
    await run(['encrypt', dir, '--project', 'p', '--service', service.url, '--passthrough', 'robots.txt', '--no-spa-fallback']);
    expect((await readTree(dir)).get('robots.txt')!.toString()).toBe('User-agent: *');
  });

  it('records where the site\'s API is with --api, inside the encrypted index only', async () => {
    const dir = await makeSite({ 'index.html': 'home' });
    await run(['encrypt', dir, '--project', 'p', '--service', service.url, '--api', 'https://api.example.com/', '--api', '/api']);
    const tree = await readTree(dir);
    expect((await readIndex(tree, service.requests[0]!.body.key)).api).toEqual(['https://api.example.com', '/api']);
    for (const [name, content] of tree) expect(content.includes('api.example.com'), name).toBe(false);

    const plain = await makeSite({ 'index.html': 'home' });
    await run(['encrypt', plain, '--project', 'p', '--service', service.url]);
    expect((await readIndex(await readTree(plain), service.requests[1]!.body.key)).api).toBeUndefined();

    // From the environment, where a build's other settings also come from.
    const fromEnv = await makeSite({ 'index.html': 'home' });
    await run(['encrypt', fromEnv, '--project', 'p', '--service', service.url], { GATECRYPT_API: 'https://a.example.com, /api' });
    expect((await readIndex(await readTree(fromEnv), service.requests[2]!.body.key)).api).toEqual(['https://a.example.com', '/api']);
  });

  it('warns on stderr about files the host can no longer read', async () => {
    const dir = await makeSite({ 'index.html': 'home', '_redirects': '/* /index.html 200' });
    const { stderr } = await run(['encrypt', dir, '--project', 'p', '--service', service.url]);
    expect(stderr).toContain('_redirects is a file your host');
  });

  it('translates the sign-in page with --lang and --text', async () => {
    const dir = await makeSite({ 'index.html': 'home' });
    const text = path.join(await makeSite({ 'de.json': JSON.stringify({ google: 'Weiter mit Google' }) }), 'de.json');
    await run(['encrypt', dir, '--project', 'p', '--service', service.url, '--lang', 'de', '--text', text]);
    const loader = (await readTree(dir)).get('index.html')!.toString();
    expect(loader).toContain('<html lang="de">');
    expect(loader).toContain('>Weiter mit Google</button>');
  });

  it('fails clearly, and leaves nothing deployable, when the key is rejected', async () => {
    service.statuses = [401];
    const dir = await makeSite({ 'index.html': 'home' });
    await expect(run(['encrypt', dir, '--project', 'p', '--service', service.url])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('could not register the build key'),
    });
    expect(await readdir(dir)).toEqual([]);
  });

  it.each([
    ['no deploy token', ['--project', 'p'], { GATECRYPT_DEPLOY_TOKEN: '' }, 'GATECRYPT_DEPLOY_TOKEN'],
    ['no project ID', [], {}, 'GATECRYPT_PROJECT_ID'],
    ['a service address that is not one', ['--project', 'p', '--service', 'gate.example'], {}, 'is not a URL'],
    ['a base that is a URL', ['--project', 'p', '--base', 'https://cdn.example/'], {}, 'must be a path'],
    ['a --text file that cannot be read', ['--project', 'p', '--text', '/no/such/file.json'], {}, 'could not read --text'],
    ['an unknown sentence in --text', ['--project', 'p', '--text', 'TEXT_FILE'], {}, 'text.nope is not a sentence'],
    ['a bad --lang', ['--project', 'p', '--lang', 'x y'], {}, 'lang must be a language tag'],
    ['an --api that is not https', ['--project', 'p', '--api', 'http://api.example.com'], {}, 'must be https'],
  ])('fails closed on %s: the plaintext is not left behind', async (_case, args, env, message) => {
    const dir = await makeSite({ 'index.html': 'SECRET home', 'assets/app.js': 'SECRET' });
    const textFile = path.join(dir, '..', `${path.basename(dir)}-text.json`);
    await writeFile(textFile, JSON.stringify({ nope: 'x' }));
    const resolved = args.map((arg) => (arg === 'TEXT_FILE' ? textFile : arg));
    await expect(run(['encrypt', dir, ...resolved], env)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(message),
    });
    expect(await readdir(dir)).toEqual([]);
    expect(service.requests).toEqual([]);
  });

  it('leaves alone a folder that is not a site, or that is already encrypted', async () => {
    const notASite = await makeSite({ 'notes.txt': 'keep me' });
    await expect(run(['encrypt', notASite, '--project', 'p', '--service', service.url])).rejects.toMatchObject({
      stderr: expect.stringContaining('no index.html'),
    });
    await expect(run(['encrypt', notASite], { GATECRYPT_DEPLOY_TOKEN: '' })).rejects.toMatchObject({
      stderr: expect.stringContaining('no index.html'),
    });
    expect(await readdir(notASite)).toEqual(['notes.txt']);

    const dir = await makeSite({ 'index.html': 'home' });
    await run(['encrypt', dir, '--project', 'p', '--service', service.url]);
    const before = await readTree(dir);
    await expect(run(['encrypt', dir, '--project', 'p', '--service', service.url])).rejects.toMatchObject({
      stderr: expect.stringContaining('already encrypted'),
    });
    expect(await readTree(dir)).toEqual(before);
    expect(service.requests).toHaveLength(1);
  });

  it('checks the project and token without changing anything', async () => {
    const { stdout } = await run(['check', '--project', 'proj', '--service', service.url]);
    expect(stdout).toContain(`the deploy token works for "Fixture" (proj) at ${service.url}`);
    expect(stdout).toContain('site addresses: https://fixture.example');
    expect(service.requests).toMatchObject([{ method: 'GET', path: '/v1/projects/proj/check' }]);

    service.project = { name: 'Fixture', origins: [] };
    expect((await run(['check', '--project', 'proj', '--service', service.url])).stdout).toContain('no site address yet');

    service.statuses = [401];
    await expect(run(['check', '--project', 'proj', '--service', service.url])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('Check the deploy token'),
    });
  });

  it('explains itself', async () => {
    await expect(run(['encrypt'])).rejects.toMatchObject({ stderr: expect.stringContaining('Usage') });
    await expect(run(['decrypt', '.'])).rejects.toMatchObject({ stderr: expect.stringContaining('Usage') });
    const help = (await run(['--help'])).stdout;
    expect(help).toContain('gatecrypt encrypt <dir>');
    expect(help).toContain('gatecrypt check');
    expect((await run([])).stdout).toBe(help);
    expect((await run(['--version'])).stdout.trim()).toBe(VERSION);
    expect((await run(['-v'])).stdout.trim()).toBe(VERSION);
  });
});
