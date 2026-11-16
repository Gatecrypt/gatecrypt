import { existsSync } from 'node:fs';
import { readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  b64urlDecode,
  decryptBlob,
  fileAad,
  importKey,
  indexAad,
  parseManifest,
  type SiteIndex,
} from '../src/format.js';
import { describe, expect, it } from 'vitest';
import { NotASiteError, contentType, encryptSite, type EncryptSiteOptions } from '../src/encrypt-site.js';
import { makeSite, readTree } from './helpers.js';

const MARKER = 'PLAINTEXT_MARKER_3b1f';
const binary = new Uint8Array(5000).map((_, i) => (i * 31) % 256);

const site = () =>
  makeSite({
    'index.html': `<html><body>${MARKER} home</body></html>`,
    'assets/app-abc123.js': `console.log("${MARKER} js")`,
    'assets/style.css': `body::after{content:"${MARKER}"}`,
    [`assets/${MARKER}-route.js`]: 'export default 1',
    'img/logo.png': binary,
    'empty.txt': '',
    'CNAME': 'example.com',
  });

async function run(dir: string, overrides: Partial<EncryptSiteOptions> = {}) {
  const registered: { keyId: string; key: string }[] = [];
  const result = await encryptSite({
    dir,
    projectId: 'proj',
    serviceUrl: 'https://gate.example',
    passthrough: ['CNAME'],
    fallback: 'index.html',
    plainFiles: { 'index.html': '<html>loader</html>', '404.html': '<html>loader</html>', 'gatecrypt-sw.js': '/*sw*/' },
    register: async (key) => {
      registered.push(key);
    },
    ...overrides,
  });
  return { result, registered };
}

async function decryptAll(dir: string, rawKey: string) {
  const tree = await readTree(dir);
  const manifest = parseManifest(JSON.parse(tree.get('gatecrypt.json')!.toString()));
  const key = await importKey(b64urlDecode(rawKey), ['decrypt']);
  const blob = (name: string) => new Uint8Array(tree.get(name)!);
  const index = JSON.parse(
    Buffer.from(await decryptBlob(key, blob(manifest.index), indexAad(manifest.keyId))).toString(),
  ) as SiteIndex;
  const files = new Map<string, Buffer>();
  for (const [file, entry] of Object.entries(index.files)) {
    files.set(file, Buffer.from(await decryptBlob(key, blob(`gatecrypt/${entry.b}`), fileAad(manifest.keyId, file))));
  }
  return { tree, manifest, index, files };
}

describe('encryptSite', () => {
  it('leaves no plaintext content or file names in the output', async () => {
    const dir = await site();
    await run(dir);
    const tree = await readTree(dir);
    for (const [name, content] of tree) {
      expect(name).not.toContain(MARKER);
      expect(content.includes(MARKER), `${name} contains the marker`).toBe(false);
    }
    // Nothing but the loader files, the manifest, the passthrough file and opaque blobs.
    const names = [...tree.keys()].filter((n) => !/^gatecrypt\/[0-9a-f]{32}\.bin$/.test(n)).sort();
    expect(names).toEqual(['404.html', 'CNAME', 'gatecrypt-sw.js', 'gatecrypt.json', 'index.html']);
    expect(tree.get('index.html')!.toString()).toBe('<html>loader</html>');
    expect(existsSync(`${dir}.gatecrypt-tmp`)).toBe(false);
  });

  it('round-trips every file through the registered key', async () => {
    const dir = await site();
    const { result, registered } = await run(dir);
    expect(registered).toHaveLength(1);
    expect(registered[0]!.keyId).toBe(result.keyId);
    expect(b64urlDecode(registered[0]!.key)).toHaveLength(32);

    const { manifest, index, files } = await decryptAll(dir, registered[0]!.key);
    expect(manifest).toMatchObject({ projectId: 'proj', keyId: result.keyId, service: 'https://gate.example' });
    expect(files.get('index.html')!.toString()).toBe(`<html><body>${MARKER} home</body></html>`);
    expect(files.get('assets/app-abc123.js')!.toString()).toContain(`${MARKER} js`);
    expect(new Uint8Array(files.get('img/logo.png')!)).toEqual(binary);
    expect(files.get('empty.txt')!.byteLength).toBe(0);
    expect([...files.keys()].sort()).toEqual(
      ['assets/app-abc123.js', 'assets/style.css', `assets/${MARKER}-route.js`, 'empty.txt', 'img/logo.png', 'index.html'].sort(),
    );
    expect(index.fallback).toBe('index.html');
    expect(index.passthrough).toEqual(['CNAME']);
    expect(index.files['index.html']!.t).toBe('text/html; charset=utf-8');
    expect(index.files['assets/app-abc123.js']!.t).toBe('text/javascript; charset=utf-8');
    expect(index.files['img/logo.png']!.t).toBe('image/png');
    expect(result.encrypted).toBe(6);
  });

  it('uses a new key, key id and IVs for every build, and a unique IV per file', async () => {
    const a = await site();
    const b = await site();
    const first = await run(a);
    const second = await run(b);
    expect(first.registered[0]!.key).not.toBe(second.registered[0]!.key);
    expect(first.result.keyId).not.toBe(second.result.keyId);

    const ivs = [...(await readTree(a))]
      .filter(([name]) => name.startsWith('gatecrypt/'))
      .map(([, blob]) => blob.subarray(4, 16).toString('hex'));
    expect(ivs).toHaveLength(7); // six files and the index
    expect(new Set(ivs).size).toBe(ivs.length);
  });

  it('keeps passthrough files in plaintext, by exact path, prefix or pattern', async () => {
    const dir = await makeSite({
      'index.html': 'home',
      'robots.txt': 'User-agent: *',
      '.well-known/security.txt': 'Contact: x',
      'img/a.ico': 'ico',
      'robots.txt.bak': 'secret backup',
    });
    const { result, registered } = await run(dir, { passthrough: ['robots.txt', '.well-known/', /\.ico$/] });
    expect(result.passthrough).toEqual(['.well-known/security.txt', 'img/a.ico', 'robots.txt']);
    const { tree, files } = await decryptAll(dir, registered[0]!.key);
    expect(tree.get('robots.txt')!.toString()).toBe('User-agent: *');
    expect(tree.get('.well-known/security.txt')!.toString()).toBe('Contact: x');
    expect([...files.keys()].sort()).toEqual(['index.html', 'robots.txt.bak']);
  });

  it("keeps the site's own 404.html when it is a passthrough file", async () => {
    const dir = await makeSite({ 'index.html': 'home', '404.html': 'custom not found' });
    await run(dir, { passthrough: ['404.html'] });
    expect((await readTree(dir)).get('404.html')!.toString()).toBe('custom not found');
  });

  it('fails closed: if the key cannot be registered, no plaintext is left behind', async () => {
    const dir = await site();
    await expect(
      run(dir, {
        register: async () => {
          throw new Error('service down');
        },
      }),
    ).rejects.toThrow('service down');
    expect(await readdir(dir)).toEqual([]);
    expect(existsSync(`${dir}.gatecrypt-tmp`)).toBe(false);
  });

  it('registers the key before touching the output directory', async () => {
    const dir = await site();
    let seenDuringRegister: string[] = [];
    await run(dir, {
      register: async () => {
        seenDuringRegister = await readdir(dir);
      },
    });
    expect(seenDuringRegister).toContain('assets');
    expect(seenDuringRegister).not.toContain('gatecrypt.json');
  });

  it('refuses a directory without index.html, and leaves it alone', async () => {
    const dir = await makeSite({ 'notes.txt': 'not a site' });
    await expect(run(dir)).rejects.toThrow('no index.html');
    await expect(run(dir)).rejects.toBeInstanceOf(NotASiteError);
    expect(await readdir(dir)).toEqual(['notes.txt']);
  });

  it('refuses a folder that does not exist', async () => {
    await expect(run(path.join(tmpdir(), 'gatecrypt-no-such-folder'))).rejects.toThrow('there is no folder at');
  });

  it('refuses a directory it has already encrypted, and leaves the ciphertext alone', async () => {
    const dir = await site();
    await run(dir);
    const before = await readTree(dir);
    await expect(run(dir)).rejects.toThrow('already encrypted');
    expect(await readTree(dir)).toEqual(before);
  });

  // Making a link needs special rights on Windows.
  it.skipIf(process.platform === 'win32')('follows links to files, and refuses links to folders without touching anything', async () => {
    const outside = await makeSite({ 'shared.txt': `${MARKER} linked`, 'folder/a.txt': 'a' });
    const dir = await makeSite({ 'index.html': 'home' });
    await symlink(path.join(outside, 'shared.txt'), path.join(dir, 'shared.txt'));
    await symlink(path.join(outside, 'shared.txt'), path.join(dir, 'CNAME'));
    const { registered } = await run(dir);
    const { tree, files } = await decryptAll(dir, registered[0]!.key);
    expect(files.get('shared.txt')!.toString()).toBe(`${MARKER} linked`);
    // A passthrough link becomes a real file, not a link out of the folder.
    expect(tree.get('CNAME')!.toString()).toBe(`${MARKER} linked`);

    const linked = await makeSite({ 'index.html': 'home' });
    await symlink(path.join(outside, 'folder'), path.join(linked, 'folder'));
    await expect(run(linked)).rejects.toThrow('folder is a link to a folder');
    expect((await readdir(linked)).sort()).toEqual(['folder', 'index.html']);

    const broken = await makeSite({ 'index.html': 'home' });
    await symlink(path.join(outside, 'gone.txt'), path.join(broken, 'gone.txt'));
    await expect(run(broken)).rejects.toThrow('does not exist');
  });

  it('warns about files a host reads itself, and about other service workers, unless they are passed through', async () => {
    const files = {
      'index.html': 'home',
      '_headers': '/*\n  X-Frame-Options: DENY',
      '_redirects': '/* /index.html 200',
      'robots.txt': 'User-agent: *',
      '.well-known/security.txt': 'Contact: x',
      'sw.js': 'self.addEventListener("fetch", () => {})',
      'assets/workbox-1a2b3c.js': '',
      'assets/app.js': '',
    };
    const warnings: string[] = [];
    await run(await makeSite(files), { warn: (message) => warnings.push(message) });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('.well-known/security.txt, _headers, _redirects, robots.txt are files your host');
    expect(warnings[0]).toContain('"passthrough"');
    expect(warnings[1]).toContain('assets/workbox-1a2b3c.js, sw.js look like a service worker');

    const quiet: string[] = [];
    await run(await makeSite({ 'index.html': 'home', 'robots.txt': 'x', 'assets/app.js': '', 'news/sw.json': '' }), {
      passthrough: ['robots.txt'],
      warn: (message) => quiet.push(message),
    });
    expect(quiet).toEqual([]);
  });

  it('passes on what the service says about the project', async () => {
    const { result } = await run(await site(), { register: async () => ({ name: 'Handbook', origins: ['https://h.example'] }) });
    expect(result.project).toEqual({ name: 'Handbook', origins: ['https://h.example'] });
    expect((await run(await site())).result.project).toEqual({});
  });

  it('refuses builds that use reserved names or a missing fallback', async () => {
    const own = await makeSite({ 'index.html': 'x', 'gatecrypt.json': '{}' });
    await expect(run(own)).rejects.toThrow('reserves');
    // It was a plaintext site that could not be protected: nothing is left to deploy.
    expect(await readdir(own)).toEqual([]);
    await expect(run(await makeSite({ 'index.html': 'x', 'gatecrypt/a.bin': '' }), { passthrough: ['gatecrypt/'] })).rejects.toThrow('reserves');
    await expect(run(await makeSite({ 'index.html': 'x' }), { passthrough: ['index.html'] })).rejects.toThrow(
      'cannot be a passthrough',
    );
    await expect(run(await makeSite({ 'index.html': 'x' }), { fallback: 'app.html' })).rejects.toThrow('fallback');
  });
});

describe('contentType', () => {
  it.each([
    ['index.html', 'text/html; charset=utf-8'],
    ['a/b.css', 'text/css; charset=utf-8'],
    ['x.mjs', 'text/javascript; charset=utf-8'],
    ['data.json', 'application/json; charset=utf-8'],
    ['x.wasm', 'application/wasm'],
    ['x.svg', 'image/svg+xml'],
    ['x.woff2', 'font/woff2'],
    ['x.unknownext', 'application/octet-stream'],
    ['LICENSE', 'application/octet-stream'],
  ])('%s -> %s', (file, type) => {
    expect(contentType(file)).toBe(type);
  });
});
