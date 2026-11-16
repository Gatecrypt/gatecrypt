import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyDir, encryptSite, readSite, type EncryptSiteResult } from './encrypt-site.js';
import { SW_NAME } from './format.js';
import { renderLoaderPage } from './loader-html.js';
import { checkProject, normalizeServiceUrl, registerKey, type ProjectInfo } from './register.js';
import { checkText, type LoaderText } from './text.js';

/** What the Vite plugin, the CLI and protectSite() all accept. */
export interface CommonOptions {
  /** Project ID from the Gatecrypt dashboard. Default: the GATECRYPT_PROJECT_ID environment variable. */
  projectId?: string;
  /** Deploy token. Default: the GATECRYPT_DEPLOY_TOKEN environment variable. Keep it out of source control. */
  deployToken?: string;
  /** Origin of the Gatecrypt service. Default: the GATECRYPT_SERVICE_URL environment variable, then https://api.gatecrypt.dev. */
  serviceUrl?: string;
  /**
   * Files to leave unencrypted: exact paths relative to the output directory,
   * `dir/` prefixes, or regular expressions. Default: `['CNAME', '.nojekyll']`.
   */
  passthrough?: (string | RegExp)[];
  /** Serve index.html for navigations that match no file, so client-side routes survive a reload. Default true. */
  spaFallback?: boolean;
  /** Heading and tab title of the sign-in page. Public. Short for `text.title`. */
  title?: string;
  /** Language of the sign-in page, as a BCP 47 tag such as "de". Default "en". */
  lang?: string;
  /** Replacements for the sign-in page's built-in sentences, to translate or reword it. Public. */
  text?: Partial<LoaderText>;
  /**
   * Your own API, if the site has one: an address such as "https://api.example.com"
   * (a path may follow), or a path on the site's own address such as "/api".
   * Calls the site makes to it carry the visitor's token in an `Authorization`
   * header, which the API checks with `gatecrypt/server` or any JWT library.
   * The addresses are kept inside the encrypted build. Default: the
   * GATECRYPT_API environment variable (several are separated by commas).
   */
  api?: string | string[];
}

export interface ProtectOptions extends CommonOptions {
  /** Directory holding the finished build. Rewritten in place. */
  dir: string;
  /** Path the site is served under: "/" or "/repo/". A relative base ("./") disables the 404.html loader. */
  base?: string;
  /** Receives warnings. Default: console.warn. */
  warn?: (message: string) => void;
}

export interface ProtectResult extends EncryptSiteResult {
  projectId: string;
  serviceUrl: string;
}

export const DEFAULT_SERVICE_URL = 'https://api.gatecrypt.dev';

/** Options with defaults applied and checked. */
export interface Settings {
  projectId: string;
  deployToken: string;
  serviceUrl: string;
  passthrough: (string | RegExp)[];
  spaFallback: boolean;
  lang: string;
  text: Partial<LoaderText>;
  api: string[];
}

/**
 * Checks one `api` entry and gives its canonical form. A token is only ever
 * sent over HTTPS (or to this machine), and only to an address that is spelled
 * out: no wildcards, nothing after the path.
 */
export function normalizeApi(entry: string): string {
  const problem = (why: string): Error =>
    new Error(`Gatecrypt: api must be an address like "https://api.example.com" or a path like "/api": "${entry}" ${why}`);
  if (typeof entry !== 'string' || !entry) throw problem('is empty');
  if (entry.startsWith('/')) {
    if (entry.startsWith('//') || /[?#*\\\s]/.test(entry)) throw problem('is not a plain path');
    return entry;
  }
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    throw problem('is neither');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw problem('must be https');
  if (url.search || url.hash || url.username || url.password || entry.includes('*')) throw problem('has more than an address and a path');
  return url.origin + (url.pathname === '/' ? '' : url.pathname);
}

/**
 * Applies defaults and the environment, and throws (with a message that says
 * what to do) if something a build needs is missing or malformed. Touches
 * nothing and calls nobody.
 */
export function resolveSettings(options: CommonOptions): Settings {
  const env = process.env;
  const projectId = options.projectId || env.GATECRYPT_PROJECT_ID;
  if (!projectId) {
    throw new Error(
      'Gatecrypt: no project ID. Pass it (projectId, or --project) or set the GATECRYPT_PROJECT_ID ' +
        'environment variable. It is on the project page of the Gatecrypt dashboard.',
    );
  }
  const deployToken = options.deployToken || env.GATECRYPT_DEPLOY_TOKEN;
  if (!deployToken) {
    throw new Error(
      'Gatecrypt: no deploy token. Set the GATECRYPT_DEPLOY_TOKEN environment variable ' +
        '(create a token on the project page of the Gatecrypt dashboard).',
    );
  }
  const lang = options.lang ?? 'en';
  if (!/^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(lang)) {
    throw new Error(`Gatecrypt: lang must be a language tag such as "de" or "pt-BR" (got "${lang}")`);
  }
  const text = { ...checkText(options.text) };
  if (options.title) text.title = options.title;
  return {
    projectId,
    deployToken,
    serviceUrl: normalizeServiceUrl(options.serviceUrl || env.GATECRYPT_SERVICE_URL || DEFAULT_SERVICE_URL),
    passthrough: options.passthrough ?? ['CNAME', '.nojekyll'],
    spaFallback: options.spaFallback ?? true,
    lang,
    text,
    api: [options.api ?? (env.GATECRYPT_API || undefined)?.split(',').map((entry) => entry.trim()) ?? []].flat().map(normalizeApi),
  };
}

// Built next to this module: the loader script and the service worker.
const asset = (name: string): Promise<string> =>
  readFile(fileURLToPath(new URL(`../dist/${name}`, import.meta.url)), 'utf8');

/**
 * Turns a finished static build into a protected one: encrypts every file
 * under a fresh key, registers that key with the service, and writes the
 * plaintext sign-in loader and service worker. Used by the Vite plugin and
 * the CLI.
 *
 * Fails closed. Once `dir` is known to hold a plaintext site, any failure
 * (a missing token, a bad option, the service refusing the key) empties it,
 * so a build that was meant to be protected is never left deployable in
 * plaintext. A directory that holds no site, or one that is already
 * encrypted, is refused and left as it is.
 */
export async function protectSite(options: ProtectOptions): Promise<ProtectResult> {
  const dir = path.resolve(options.dir);
  const warn = options.warn ?? ((message: string) => console.warn(message));
  await readSite(dir);
  try {
    const settings = resolveSettings(options);
    const { projectId, serviceUrl, deployToken } = settings;

    // The service worker must be same-origin, so the site cannot live on a separate asset host.
    const base = options.base ?? '/';
    if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(base)) {
      throw new Error(`Gatecrypt: the site base must be a path, not a full URL (got "${base}")`);
    }
    const absoluteBase = base.startsWith('/');
    const loaderPage = renderLoaderPage({
      base: absoluteBase ? (base.endsWith('/') ? base : `${base}/`) : './',
      lang: settings.lang,
      text: settings.text,
      loaderJs: await asset('loader.js'),
    });
    const plainFiles: Record<string, string> = {
      'index.html': loaderPage,
      [SW_NAME]: await asset('sw.js'),
    };
    // Hosts such as GitHub Pages serve 404.html for unknown paths. Making it the loader lets a
    // first visit to a deep link sign in. It needs an absolute base to find its files from any depth.
    if (absoluteBase) plainFiles['404.html'] = loaderPage;
    else {
      warn(
        'gatecrypt: the site base is relative, so no 404.html loader is written; ' +
          'first visits to deep links will not reach the sign-in page.',
      );
    }

    const result = await encryptSite({
      dir,
      projectId,
      serviceUrl,
      passthrough: settings.passthrough,
      fallback: settings.spaFallback ? 'index.html' : null,
      api: settings.api,
      plainFiles,
      register: ({ keyId, key }) => registerKey({ serviceUrl, projectId, deployToken, keyId, key }),
      warn,
    });
    if (result.project.origins?.length === 0) {
      warn(
        'gatecrypt: this project has no site address yet, so nobody can sign in. ' +
          'Add the address the site is served from on the project page of the Gatecrypt dashboard.',
      );
    }
    return { ...result, projectId, serviceUrl };
  } catch (error) {
    await emptyDir(dir);
    throw error;
  }
}

/**
 * Empties `dir` if it holds a plaintext site, so that a build which could not
 * be protected cannot be deployed. Leaves anything else alone.
 */
export async function discardSite(dir: string): Promise<void> {
  const site = await readSite(path.resolve(dir)).then(
    () => true,
    () => false,
  );
  if (site) await emptyDir(path.resolve(dir));
}

/** Checks that the project ID and deploy token work, without building anything. For `gatecrypt check`. */
export async function checkSetup(options: CommonOptions): Promise<ProjectInfo & { projectId: string; serviceUrl: string }> {
  const { projectId, serviceUrl, deployToken } = resolveSettings(options);
  return { ...(await checkProject({ serviceUrl, projectId, deployToken, attempts: 2 })), projectId, serviceUrl };
}

/** One line for a build log. */
export function summary(result: ProtectResult): string {
  const { name, origins } = result.project;
  return (
    `gatecrypt: encrypted ${result.encrypted} file${result.encrypted === 1 ? '' : 's'} for ` +
    `${name ? `"${name}"` : `project ${result.projectId}`}` +
    (origins?.length ? `, served at ${origins.join(', ')}` : '')
  );
}
