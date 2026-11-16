/** Pure parts of the service worker, kept apart so they can be unit tested. */
import { BLOB_DIR, MANIFEST_NAME, SW_NAME, type IndexEntry, type SiteIndex } from './format.js';

/** Paths the service worker never touches: its own plaintext files. */
export function isReserved(rel: string): boolean {
  return rel === MANIFEST_NAME || rel === SW_NAME || rel.startsWith(BLOB_DIR + '/');
}

export type Resolution =
  | { kind: 'file'; path: string; entry: IndexEntry }
  /** A directory requested without its trailing slash. */
  | { kind: 'redirect'; to: string }
  /** Not ours: let the network answer. */
  | { kind: 'network' };

/**
 * Maps a request path (relative to the scope, still percent-encoded) to a file
 * in the index, the way static hosts do: exact file, directory index, `.html`
 * extension, then the SPA fallback for navigations.
 */
export function resolvePath(index: SiteIndex, rel: string, navigating: boolean): Resolution {
  let path = rel;
  try {
    path = decodeURIComponent(rel);
  } catch {
    // Keep the raw path; it will simply not match.
  }
  const has = (p: string): boolean => Object.hasOwn(index.files, p);
  const file = (p: string): Resolution => ({ kind: 'file', path: p, entry: index.files[p]! });

  if (has(path)) return file(path);
  if (index.passthrough.includes(path)) return { kind: 'network' };
  if (path === '' || path.endsWith('/')) {
    if (has(path + 'index.html')) return file(path + 'index.html');
  } else {
    if (has(path + '.html')) return file(path + '.html');
    if (navigating && has(path + '/index.html')) return { kind: 'redirect', to: rel + '/' };
  }
  if (navigating && index.fallback && has(index.fallback)) return file(index.fallback);
  return { kind: 'network' };
}

/** Builds the response for a decrypted file, honouring a single-range `Range` header. */
export function respond(request: Request, body: ArrayBuffer, type: string): Response {
  const headers = new Headers({
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  });
  const size = body.byteLength;
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  if (!range || (!range[1] && !range[2])) return new Response(body, { headers });

  let start: number;
  let end = size - 1;
  if (range[1]) {
    start = Number(range[1]);
    if (range[2]) end = Math.min(Number(range[2]), end);
  } else {
    start = Math.max(size - Number(range[2]), 0);
  }
  if (start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  return new Response(body.slice(start, end + 1), { status: 206, headers });
}

/**
 * Whether a request is going to the site's own API, as the build's `api`
 * option described it, and so should carry the visitor's token. An entry is an
 * address, with or without a path, or a path on the site's own origin. A path
 * matches itself and everything under it, never a longer name that merely
 * starts the same way.
 */
export function wantsToken(api: readonly string[] | undefined, url: URL, siteOrigin: string): boolean {
  if (!api) return false;
  return api.some((entry) => {
    let target: URL;
    try {
      target = new URL(entry, siteOrigin);
    } catch {
      return false;
    }
    if (target.origin !== url.origin) return false;
    const path = target.pathname.replace(/\/+$/, '');
    return path === '' || url.pathname === path || url.pathname.startsWith(path + '/');
  });
}
