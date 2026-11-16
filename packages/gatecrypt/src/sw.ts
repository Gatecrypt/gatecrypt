/**
 * The service worker. Answers same-origin GETs under its scope with decrypted
 * files. Identical for every site: everything it needs comes from its scope,
 * the public manifest and the key in IndexedDB.
 */
import {
  BLOB_DIR,
  MANIFEST_NAME,
  decryptBlob,
  fileAad,
  indexAad,
  parseManifest,
  type PublicManifest,
  type SiteIndex,
} from './format.js';
import { getKey } from './idb.js';
import { isReserved, resolvePath, respond, wantsToken } from './sw-core.js';
import { visitorToken } from './token.js';

declare const self: ServiceWorkerGlobalScope;

interface State {
  keyId: string;
  key: CryptoKey;
  index: SiteIndex;
}

const scope = new URL(self.registration.scope);

let manifest: PublicManifest | undefined;
let state: State | undefined;
let refreshing: Promise<State | undefined> | undefined;
/** Whether the stored key has been looked for since this worker started: until then, `state` says nothing. */
let checked = false;

self.addEventListener('install', () => {
  void self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const rel =
    request.method === 'GET' && url.origin === scope.origin && url.pathname.startsWith(scope.pathname)
      ? url.pathname.slice(scope.pathname.length)
      : undefined;
  if (rel !== undefined && isReserved(rel)) return;

  // A call the page makes itself (fetch, XMLHttpRequest) may be one to the site's own API, which
  // is sent the visitor's token. Which addresses those are is in the encrypted index, so a call
  // made before that has been read waits for it. After that only calls to the API come this way.
  const call = request.destination === '' && request.mode !== 'navigate' && request.mode !== 'no-cors';
  if (call && !request.headers.has('authorization') && (checked ? wantsToken(state?.index.api, url, scope.origin) : true)) {
    event.respondWith(withToken(request, url, rel, event.clientId));
    return;
  }
  if (rel !== undefined) event.respondWith(handle(request, rel));
});

/**
 * Sends a call on, with the visitor's token if it is going to the site's API.
 * When the service says the visitor may no longer have one, the sign-in is
 * over: the key is already forgotten, and every open page of the site is
 * reloaded, which shows the sign-in screen.
 */
async function withToken(request: Request, url: URL, rel: string | undefined, clientId: string): Promise<Response> {
  const current = await currentState(false).catch(() => undefined);
  if (!wantsToken(current?.index.api, url, scope.origin)) return rel === undefined ? fetch(request) : handle(request, rel);
  let token: string | null;
  let over: boolean;
  try {
    ({ token, over } = await visitorToken(scope.pathname));
  } catch {
    // The service gave no answer. The call fails as it would offline, rather than reaching the
    // API without a token and being taken for a visitor who is not signed in.
    return Response.error();
  }
  if (over) {
    state = undefined;
    for (const client of await self.clients.matchAll({ type: 'window' })) {
      // A page that has moved on by itself (a single-page app's routes) is known here only by the
      // address it was first loaded at. The page that made this call says where it is now, in
      // full if the API is on the site's own origin; otherwise it goes back to where it started.
      const here = client.id === clientId && request.referrer.startsWith(scope.href) ? request.referrer : client.url;
      void client.navigate(here).catch(() => undefined);
    }
  }
  if (!token) return fetch(request);
  const headers = new Headers(request.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(new Request(request, { headers }));
}

/**
 * Re-reads the manifest and the stored key. Returns undefined when there is no
 * key for the build the host is serving now: signed out, or a new deploy.
 */
async function refresh(): Promise<State | undefined> {
  try {
    const res = await fetch(new URL(MANIFEST_NAME, scope), { cache: 'no-store' });
    if (!res.ok) throw new Error(`manifest: ${res.status}`);
    manifest = parseManifest(await res.json());
  } catch (error) {
    // Offline or a blip: carry on with the manifest we already have, if any.
    if (!manifest) throw error;
  }
  const stored = await getKey(scope.pathname);
  checked = true;
  if (!stored || stored.keyId !== manifest.keyId) return (state = undefined);
  if (state?.keyId === stored.keyId) return state;

  const res = await fetch(new URL(manifest.index, scope));
  if (!res.ok) throw new Error(`index: ${res.status}`);
  const plain = await decryptBlob(stored.key, await res.arrayBuffer(), indexAad(stored.keyId));
  const index = JSON.parse(new TextDecoder().decode(plain)) as SiteIndex;
  return (state = { keyId: stored.keyId, key: stored.key, index });
}

/** Navigations always re-check; subresources reuse what the page was loaded with. */
function currentState(navigating: boolean): Promise<State | undefined> {
  if (state && !navigating) return Promise.resolve(state);
  return (refreshing ??= refresh().finally(() => {
    refreshing = undefined;
  }));
}

/**
 * The plaintext loader, straight from the host. Asked for as the site's root
 * rather than "index.html", because many hosts redirect one to the other, and
 * a response that followed a redirect may not answer a navigation. If the host
 * redirects anyway, the content is handed over in a fresh response.
 */
async function loaderPage(): Promise<Response> {
  const res = await fetch(scope, { cache: 'no-store' });
  if (!res.redirected) return res;
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function handle(request: Request, rel: string): Promise<Response> {
  const navigating = request.mode === 'navigate';
  const current = await currentState(navigating).catch(() => undefined);
  if (!current) {
    // No usable key. Navigations get the plaintext loader, which shows the sign-in screen.
    return navigating ? loaderPage() : fetch(request);
  }

  const target = resolvePath(current.index, rel, navigating);
  if (target.kind === 'network') return fetch(request);
  if (target.kind === 'redirect') {
    const to = new URL(request.url);
    to.pathname = scope.pathname + target.to;
    return Response.redirect(to.href, 302);
  }

  const res = await fetch(new URL(`${BLOB_DIR}/${target.entry.b}`, scope));
  if (!res.ok) return new Response('Not found', { status: res.status === 404 ? 404 : 502 });
  let body: ArrayBuffer;
  try {
    body = await decryptBlob(current.key, await res.arrayBuffer(), fileAad(current.keyId, target.path));
  } catch {
    return new Response(`Gatecrypt could not decrypt ${target.path}`, { status: 500 });
  }
  return respond(request, body, target.entry.t);
}
