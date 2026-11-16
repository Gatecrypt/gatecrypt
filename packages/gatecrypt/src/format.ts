/**
 * The Gatecrypt file format, shared by the build plugin (Node), the loader and
 * the service worker. WebCrypto only. See PROTOCOL.md, "File format".
 */

export const FORMAT_VERSION = 1;
export const MANIFEST_NAME = 'gatecrypt.json';
export const SW_NAME = 'gatecrypt-sw.js';
export const BLOB_DIR = 'gatecrypt';
export const KEY_BYTES = 32;
export const IV_BYTES = 12;
/** postMessage `type` used by the service's popup when it reports back to the loader. */
export const MESSAGE_TYPE = 'gatecrypt:result';

const MAGIC = [0x47, 0x43, 0x45, 0x31]; // "GCE1"
const HEADER_BYTES = MAGIC.length + IV_BYTES;
const TAG_BYTES = 16;
const BLOB_NAME = /^[0-9a-f]{16,64}\.bin$/;

/** Shipped in plaintext next to the loader. Contains nothing secret. */
export interface PublicManifest {
  v: 1;
  projectId: string;
  keyId: string;
  /** Base URL of the Gatecrypt service, no trailing slash. */
  service: string;
  /** Path of the encrypted index, relative to the site base. */
  index: string;
}

export interface IndexEntry {
  /** Blob file name inside BLOB_DIR. */
  b: string;
  /** Content type to respond with. */
  t: string;
}

/** The encrypted index: maps original paths to blobs. */
export interface SiteIndex {
  v: 1;
  files: Record<string, IndexEntry>;
  /** Path served for navigations that match no file (SPA fallback), or null. */
  fallback: string | null;
  /** Paths left in plaintext on the host; the service worker lets these through. */
  passthrough: string[];
  /**
   * Where the service worker sends the visitor's token: the site's own API.
   * Each entry is an address ("https://api.example.com", optionally with a
   * path) or a path on the site's own origin ("/api").
   */
  api?: string[];
}

/** Version of the service's HTTP interface this package speaks: the first path segment of every call. */
export const API = '/v1';

/** What the service posts to the loader. */
export type ResultMessage =
  | { type: typeof MESSAGE_TYPE; req: string; ok: true; keyId: string; key: string; email?: string; grant?: string }
  | { type: typeof MESSAGE_TYPE; req: string; ok: false; error: string };

/** The curve and hash of a browser's own signing key, and of the proofs it makes with it. */
export const DEVICE_KEY = { name: 'ECDSA', namedCurve: 'P-256' } as const;
export const DEVICE_SIGNATURE = { name: 'ECDSA', hash: 'SHA-256' } as const;

const encoder = new TextEncoder();

/** What a browser signs to be given a token: the grant it holds and the challenge the service set. */
export const proofInput = (grant: string, challenge: string): Uint8Array<ArrayBuffer> =>
  encoder.encode(`gatecrypt/v1/token\n${grant}\n${challenge}`);

export const fileAad = (keyId: string, path: string): Uint8Array<ArrayBuffer> =>
  encoder.encode(`gatecrypt/v1/file\n${keyId}\n${path}`);

export const indexAad = (keyId: string): Uint8Array<ArrayBuffer> =>
  encoder.encode(`gatecrypt/v1/index\n${keyId}`);

/** Imports raw key bytes as a non-extractable AES-GCM key. */
export function importKey(raw: Uint8Array<ArrayBuffer>, usages: KeyUsage[]): Promise<CryptoKey> {
  if (raw.byteLength !== KEY_BYTES) throw new Error('Gatecrypt: key must be 32 bytes');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usages);
}

export function randomIv(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(IV_BYTES));
}

/** magic ‖ iv ‖ ciphertext+tag */
export async function encryptBlob(
  key: CryptoKey,
  plaintext: Uint8Array<ArrayBuffer>,
  aad: Uint8Array<ArrayBuffer>,
  iv: Uint8Array<ArrayBuffer> = randomIv(),
): Promise<Uint8Array<ArrayBuffer>> {
  if (iv.byteLength !== IV_BYTES) throw new Error('Gatecrypt: IV must be 12 bytes');
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plaintext);
  const out = new Uint8Array(HEADER_BYTES + ciphertext.byteLength);
  out.set(MAGIC, 0);
  out.set(iv, MAGIC.length);
  out.set(new Uint8Array(ciphertext), HEADER_BYTES);
  return out;
}

/** Throws if the blob is malformed, was encrypted under another key, or was tampered with or moved. */
export async function decryptBlob(
  key: CryptoKey,
  blob: ArrayBuffer | Uint8Array<ArrayBuffer>,
  aad: Uint8Array<ArrayBuffer>,
): Promise<ArrayBuffer> {
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  if (bytes.byteLength < HEADER_BYTES + TAG_BYTES || MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new Error('Gatecrypt: not an encrypted blob');
  }
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(MAGIC.length, HEADER_BYTES), additionalData: aad },
    key,
    bytes.subarray(HEADER_BYTES),
  );
}

export function parseManifest(value: unknown): PublicManifest {
  const m = value as Partial<PublicManifest> | null;
  if (
    !m ||
    m.v !== FORMAT_VERSION ||
    typeof m.projectId !== 'string' ||
    typeof m.keyId !== 'string' ||
    typeof m.service !== 'string' ||
    !/^https?:\/\/[^/]+$/.test(m.service) ||
    typeof m.index !== 'string' ||
    !m.index.startsWith(BLOB_DIR + '/') ||
    !BLOB_NAME.test(m.index.slice(BLOB_DIR.length + 1))
  ) {
    throw new Error('Gatecrypt: invalid manifest');
  }
  return { v: 1, projectId: m.projectId, keyId: m.keyId, service: m.service, index: m.index };
}

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('Gatecrypt: invalid base64url');
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
