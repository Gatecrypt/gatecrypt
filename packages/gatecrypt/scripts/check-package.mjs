/**
 * Checks the package as npm would ship it, not as it sits in the repository:
 * packs it, then looks at the tarball from a consumer's side.
 *
 *   - the tarball holds what it should and nothing else
 *   - publint and arethetypeswrong have no complaints
 *   - a project that installs it can import every entry point, with types,
 *     under both of TypeScript's modern module resolutions
 *   - the CLI runs
 *
 * `--release` also insists on what a publish needs (a repository address).
 * Run after a build: `pnpm check:package`.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = (name) => path.join(pkgDir, 'node_modules', '.bin', name);
const release = process.argv.includes('--release');
const shell = process.platform === 'win32';

const problems = [];
const check = (ok, message) => {
  if (!ok) problems.push(message);
};
/** Runs a command; returns its output, or records the failure. */
async function run(label, command, args, options = {}) {
  try {
    const { stdout } = await exec(command, args, { cwd: pkgDir, shell, ...options });
    return stdout;
  } catch (error) {
    problems.push(`${label} failed:\n${error.stdout ?? ''}${error.stderr ?? error.message}`);
    return '';
  }
}

const manifest = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8'));
const work = await mkdtemp(path.join(tmpdir(), 'gatecrypt-pack-'));
try {
  // ---- pack
  await exec('pnpm', ['pack', '--pack-destination', work], { cwd: pkgDir, shell });
  const tarball = path.join(work, (await readdir(work)).find((name) => name.endsWith('.tgz')));
  const consumer = path.join(work, 'consumer');
  const installed = path.join(consumer, 'node_modules', 'gatecrypt');
  await mkdir(installed, { recursive: true });
  await exec('tar', ['-xzf', tarball, '-C', installed, '--strip-components=1']);

  // ---- contents
  const files = (await readdir(installed, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(installed, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();
  for (const needed of [
    'package.json',
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
    'dist/index.js',
    'dist/index.d.ts',
    'dist/vite.js',
    'dist/vite.d.ts',
    'dist/client.js',
    'dist/client.d.ts',
    'dist/server.js',
    'dist/server.d.ts',
    'dist/cli.js',
    'bin/gatecrypt.js',
    'dist/loader.js',
    'dist/sw.js',
  ]) {
    check(files.includes(needed), `the tarball is missing ${needed}`);
  }
  const stray = files.filter((file) => !/^(package\.json|README\.md|LICENSE|CHANGELOG\.md|bin\/gatecrypt\.js|dist\/[\w.-]+\.(js|d\.ts))$/.test(file));
  check(stray.length === 0, `the tarball holds files it should not: ${stray.join(', ')}`);
  const shipped = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  check(!JSON.stringify(shipped).includes('workspace:'), 'the shipped package.json still has workspace: dependencies');
  check((await readFile(path.join(installed, 'bin/gatecrypt.js'), 'utf8')).startsWith('#!/usr/bin/env node\n'), 'bin/gatecrypt.js has no shebang');
  check(shipped.bin?.gatecrypt === './bin/gatecrypt.js', 'the gatecrypt command does not point at bin/gatecrypt.js');
  // The browser files must stand alone: they are inlined into customers' sites. So must the
  // one for servers, which runs on runtimes that have no node_modules.
  for (const file of ['dist/loader.js', 'dist/sw.js', 'dist/server.js']) {
    check(!/\b(import|require)\s*[("']/.test(await readFile(path.join(installed, file), 'utf8')), `${file} imports something`);
  }
  for (const field of ['license', 'description', 'homepage', 'engines', 'keywords']) {
    check(shipped[field], `package.json has no "${field}"`);
  }
  if (!shipped.repository) {
    const message = 'package.json has no "repository". npm provenance needs it to match the repository that publishes.';
    if (release) problems.push(message);
    else console.warn(`warning: ${message}`);
  }

  // ---- linters
  await run('publint', bin('publint'), ['run', tarball, '--strict']);
  await run('arethetypeswrong', bin('attw'), [tarball, '--profile', 'esm-only']);

  // ---- a consumer
  const link = (name) =>
    mkdir(path.dirname(path.join(consumer, 'node_modules', name)), { recursive: true }).then(() =>
      symlink(path.join(pkgDir, 'node_modules', name), path.join(consumer, 'node_modules', name), 'junction'),
    );
  await Promise.all([link('vite'), link('mrmime'), link('@types/node')]);
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
  await writeFile(
    path.join(consumer, 'use.ts'),
    `import gatecrypt, { type GatecryptOptions } from 'gatecrypt/vite';
import { DEFAULT_SERVICE_URL, DEFAULT_TEXT, NotASiteError, VERSION, checkSetup, protectSite } from 'gatecrypt';
import type { CommonOptions, LoaderText, ProjectInfo, ProtectOptions, ProtectResult } from 'gatecrypt';
import { getVisitor, getVisitorToken, signOut, type Visitor } from 'gatecrypt/client';
import { VisitorTokenError, visitorVerifier, type VerifiedVisitor, type VerifierOptions } from 'gatecrypt/server';
import type { Plugin } from 'vite';

const options: GatecryptOptions = { projectId: 'x', enabled: true, lang: 'de', text: { google: 'Weiter mit Google' }, api: ['https://api.example.com', '/api'] };
const plugin: Plugin = gatecrypt(options);
const empty: Plugin = gatecrypt();
const version: string = VERSION;
const url: 'https://api.gatecrypt.dev' | string = DEFAULT_SERVICE_URL;
const text: LoaderText = DEFAULT_TEXT;
const result: Promise<ProtectResult> = protectSite({ dir: 'dist' } satisfies ProtectOptions);
const project: Promise<ProjectInfo & { projectId: string }> = checkSetup({} satisfies CommonOptions);
const visitor: Promise<Visitor | null> = getVisitor();
const out: Promise<void> = signOut();
const token: Promise<string | null> = getVisitorToken();
const verify = visitorVerifier({ projectId: 'x' } satisfies VerifierOptions);
const verified: Promise<VerifiedVisitor> = verify(new Request('https://api.example.com'));
const fromNode: Promise<VerifiedVisitor> = verify({ headers: { authorization: 'Bearer x' } });
const code: VisitorTokenError['code'] = 'expired';
// @ts-expect-error a verifier needs to know its project
visitorVerifier({});
const error: Error = new NotASiteError('x');
// @ts-expect-error the types are real: this is not a number
const wrong: number = VERSION;
// @ts-expect-error unknown sentences are refused
const bad: GatecryptOptions = { text: { nope: 'x' } };
void [plugin, empty, version, url, text, result, project, visitor, out, error, wrong, bad, token, verified, fromNode, code];
`,
  );
  for (const [module, resolution] of [
    ['NodeNext', 'NodeNext'],
    ['ESNext', 'Bundler'],
  ]) {
    await run(
      `type-checking a consumer with moduleResolution ${resolution}`,
      bin('tsc'),
      ['--noEmit', '--strict', '--module', module, '--moduleResolution', resolution, '--target', 'ES2022', '--lib', 'ES2023,DOM', '--types', 'node', 'use.ts'],
      { cwd: consumer },
    );
  }
  const imported = await run(
    'importing the entry points',
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const main = await import('gatecrypt');
       const vite = await import('gatecrypt/vite');
       const client = await import('gatecrypt/client');
       const server = await import('gatecrypt/server');
       const required = (await import('node:module')).createRequire(import.meta.url)('gatecrypt/vite');
       console.log(JSON.stringify({ main: Object.keys(main).sort(), vite: typeof vite.default, required: typeof required.default, client: Object.keys(client).sort(), server: Object.keys(server).sort(), version: main.VERSION }));`,
    ],
    // Never through a shell: on Windows it would split the script at its spaces and line ends.
    { cwd: consumer, shell: false },
  );
  if (imported) {
    const seen = JSON.parse(imported);
    check(
      JSON.stringify(seen.main) === JSON.stringify(['DEFAULT_SERVICE_URL', 'DEFAULT_TEXT', 'NotASiteError', 'VERSION', 'checkSetup', 'protectSite']),
      `the main entry exports ${seen.main.join(', ')}: update this check and the changelog if that is intended`,
    );
    check(seen.vite === 'function' && seen.required === 'function', 'gatecrypt/vite has no default export (import or require)');
    check(JSON.stringify(seen.client) === JSON.stringify(['getVisitor', 'getVisitorToken', 'signOut']), `gatecrypt/client exports ${seen.client.join(', ')}`);
    check(JSON.stringify(seen.server) === JSON.stringify(['VisitorTokenError', 'visitorVerifier']), `gatecrypt/server exports ${seen.server.join(', ')}`);
    check(seen.version === manifest.version, `VERSION is ${seen.version}, package.json says ${manifest.version}`);
  }
  const cli = path.join(installed, 'bin/gatecrypt.js');
  const version = await run('gatecrypt --version', process.execPath, [cli, '--version'], { cwd: consumer, shell: false });
  check(version.trim() === manifest.version, `gatecrypt --version printed "${version.trim()}"`);
  const changelog = await readFile(path.join(pkgDir, 'CHANGELOG.md'), 'utf8');
  check(changelog.includes(`## ${manifest.version}`), `CHANGELOG.md has no entry for ${manifest.version}`);
} finally {
  await rm(work, { recursive: true, force: true });
}

if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'} with the package:\n\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
console.log(`gatecrypt ${manifest.version}: the package is fit to publish.`);
