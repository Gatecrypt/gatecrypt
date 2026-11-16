import { randomBytes } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BLOB_DIR,
  KEY_BYTES,
  MANIFEST_NAME,
  SW_NAME,
  b64urlEncode,
  encryptBlob,
  fileAad,
  importKey,
  indexAad,
  parseManifest,
  type PublicManifest,
  type SiteIndex,
} from './format.js';
import { lookup } from 'mrmime';
import { buildWarnings } from './advice.js';
import type { ProjectInfo } from './register.js';

export interface EncryptSiteOptions {
  /** Directory holding the finished plaintext build. Rewritten in place. */
  dir: string;
  projectId: string;
  /** Service base URL, no trailing slash. */
  serviceUrl: string;
  /** Files to leave in plaintext: exact paths, `dir/` prefixes, or regular expressions. */
  passthrough: (string | RegExp)[];
  /** File served for navigations that match nothing (SPA fallback), or null. */
  fallback: string | null;
  /** The site's own API: where the service worker sends the visitor's token. Kept in the encrypted index. */
  api?: string[];
  /** Plaintext files to write next to the ciphertext: the loader page(s) and the service worker. */
  plainFiles: Record<string, string>;
  /** Hands the new key to the service. Runs before `dir` is modified; if it throws, nothing is published. */
  register: (key: { keyId: string; key: string }) => Promise<ProjectInfo | void>;
  /** Told about things in the build that will not work once encrypted. */
  warn?: (message: string) => void;
}

export interface EncryptSiteResult {
  keyId: string;
  encrypted: number;
  passthrough: string[];
  /** What the service said about the project when the key was registered. */
  project: ProjectInfo;
}

/** A directory Gatecrypt will not touch: missing, not a site, or encrypted already. */
export class NotASiteError extends Error {}

/**
 * Encrypts every file in `dir` under a fresh key and replaces the directory's
 * contents with ciphertext plus the plaintext loader files.
 *
 * Fails closed: once the directory is known to hold a site, any failure
 * (including key registration) empties it, so plaintext is never left behind
 * looking like a finished build.
 */
export async function encryptSite(options: EncryptSiteOptions): Promise<EncryptSiteResult> {
  const dir = path.resolve(options.dir);
  const files = await readSite(dir);
  const staging = `${dir}.gatecrypt-tmp`;
  try {
    const result = await stage(dir, staging, files, options);
    // Swap contents rather than the directory itself, which may be a mount point.
    await emptyDir(dir);
    for (const child of await readdir(staging)) await rename(path.join(staging, child), path.join(dir, child));
    return result;
  } catch (error) {
    await emptyDir(dir);
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function stage(
  dir: string,
  staging: string,
  files: string[],
  options: EncryptSiteOptions,
): Promise<EncryptSiteResult> {
  const plainNames = new Set([MANIFEST_NAME, ...Object.keys(options.plainFiles)]);
  const isPassthrough = (file: string): boolean =>
    options.passthrough.some((rule) =>
      typeof rule === 'string' ? (rule.endsWith('/') ? file.startsWith(rule) : file === rule) : rule.test(file),
    );

  await rm(staging, { recursive: true, force: true });
  await mkdir(path.join(staging, BLOB_DIR), { recursive: true });

  const rawKey = new Uint8Array(randomBytes(KEY_BYTES));
  const keyId = b64urlEncode(new Uint8Array(randomBytes(16)));
  const key = await importKey(rawKey, ['encrypt']);

  // Random, so that names say nothing about the files. Uniqueness is checked rather than assumed.
  const usedNames = new Set<string>();
  const usedIvs = new Set<string>();
  const fresh = (bytes: number, used: Set<string>): Buffer => {
    for (;;) {
      const value = randomBytes(bytes);
      const hex = value.toString('hex');
      if (!used.has(hex)) {
        used.add(hex);
        return value;
      }
    }
  };
  const writeBlob = async (plaintext: Uint8Array<ArrayBuffer>, aad: Uint8Array<ArrayBuffer>): Promise<string> => {
    const name = `${fresh(16, usedNames).toString('hex')}.bin`;
    const blob = await encryptBlob(key, plaintext, aad, new Uint8Array(fresh(12, usedIvs)));
    await writeFile(path.join(staging, BLOB_DIR, name), blob);
    return name;
  };

  for (const warning of buildWarnings(files.filter((file) => !isPassthrough(file)))) options.warn?.(warning);

  const index: SiteIndex = { v: 1, files: {}, fallback: options.fallback, passthrough: [] };
  if (options.api?.length) index.api = options.api;
  for (const file of files) {
    if (file === MANIFEST_NAME || file === SW_NAME || file.startsWith(`${BLOB_DIR}/`)) {
      throw new Error(`Gatecrypt: the build already contains "${file}", a name Gatecrypt reserves`);
    }
    if (isPassthrough(file)) {
      if (plainNames.has(file) && file !== '404.html') {
        throw new Error(`Gatecrypt: "${file}" cannot be a passthrough file; Gatecrypt writes that file itself`);
      }
      index.passthrough.push(file);
      const target = path.join(staging, file);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(path.join(dir, file), target, { dereference: true });
      continue;
    }
    const data = new Uint8Array(await readFile(path.join(dir, file)));
    index.files[file] = { b: await writeBlob(data, fileAad(keyId, file)), t: contentType(file) };
  }
  if (index.fallback && !index.files[index.fallback]) {
    throw new Error(`Gatecrypt: fallback file "${index.fallback}" is not an encrypted file in the build`);
  }

  const indexName = await writeBlob(new TextEncoder().encode(JSON.stringify(index)), indexAad(keyId));
  const manifest: PublicManifest = {
    v: 1,
    projectId: options.projectId,
    keyId,
    service: options.serviceUrl,
    index: `${BLOB_DIR}/${indexName}`,
  };
  await writeFile(path.join(staging, MANIFEST_NAME), JSON.stringify(manifest));
  for (const [name, content] of Object.entries(options.plainFiles)) {
    if (index.passthrough.includes(name)) continue; // the site's own 404.html, kept on request
    await writeFile(path.join(staging, name), content);
  }

  let project: ProjectInfo;
  try {
    project = (await options.register({ keyId, key: b64urlEncode(rawKey) })) ?? {};
  } finally {
    rawKey.fill(0);
  }
  return { keyId, encrypted: Object.keys(index.files).length, passthrough: index.passthrough, project };
}

/**
 * The files of the plaintext site in `dir`. Throws NotASiteError, leaving the
 * directory as it is, if there is no site there to protect: no such folder,
 * no index.html, or a folder this package has already encrypted.
 */
export async function readSite(dir: string): Promise<string[]> {
  let files: string[];
  try {
    files = await listFiles(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error;
    throw new NotASiteError(`Gatecrypt: there is no folder at ${dir}. Run your build first, then encrypt its output folder.`);
  }
  if (files.includes(MANIFEST_NAME) && files.includes(SW_NAME)) {
    const encrypted = await readFile(path.join(dir, MANIFEST_NAME), 'utf8').then(
      (text) => (parseManifest(JSON.parse(text)), true),
      () => false,
    );
    if (encrypted) {
      throw new NotASiteError(`Gatecrypt: ${dir} is already encrypted. Run your build again before encrypting its output.`);
    }
  }
  if (!files.includes('index.html')) {
    throw new NotASiteError(`Gatecrypt: ${dir} has no index.html to protect. Point Gatecrypt at the folder your host serves.`);
  }
  return files;
}

/** All files under `dir` as sorted, `/`-separated relative paths. Links to files count as files. */
async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(entry.parentPath, entry.name);
    const relative = path.relative(dir, full).split(path.sep).join('/');
    if (entry.isSymbolicLink()) {
      const target = await stat(full).catch(() => null);
      if (!target?.isFile()) {
        throw new NotASiteError(
          `Gatecrypt: ${relative} is a link to ${target ? 'a folder' : 'something that does not exist'}. ` +
            'Gatecrypt only follows links to files; copy the real files into the build.',
        );
      }
      files.push(relative);
    } else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

export async function emptyDir(dir: string): Promise<void> {
  for (const child of await readdir(dir)) await rm(path.join(dir, child), { recursive: true, force: true });
}

export function contentType(file: string): string {
  const type = lookup(file) ?? 'application/octet-stream';
  return /^text\/|^application\/(json|manifest\+json)$/.test(type) ? `${type}; charset=utf-8` : type;
}
