/**
 * Optional helpers for the protected app itself:
 *
 *   import { getVisitor, getVisitorToken, signOut } from 'gatecrypt/client';
 *
 * None of them does anything useful under `vite dev`, where the site is not
 * encrypted and nobody has signed in: getVisitor() and getVisitorToken()
 * answer null.
 */
import { clearKey, getKey } from './idb.js';
import { visitorToken } from './token.js';

export interface Visitor {
  /** The address the visitor signed in with, lower-cased. */
  email: string;
}

const scopePath = async (): Promise<string | undefined> => {
  const registration = await navigator.serviceWorker?.getRegistration();
  return registration && new URL(registration.scope).pathname;
};

/**
 * Who signed in to this site in this browser, or null.
 *
 * For display ("Signed in as ..."), not for decisions: it is read from this
 * browser's own storage, which its user can change. Anything that must be
 * enforced belongs on a server that checks identity itself.
 */
export async function getVisitor(): Promise<Visitor | null> {
  try {
    const scope = await scopePath();
    const email = scope === undefined ? undefined : (await getKey(scope))?.email;
    return email ? { email } : null;
  } catch {
    return null;
  }
}

/**
 * A token that proves to your own API who the visitor is, or null when there
 * is none: nobody is signed in (as under `vite dev`), or the project's plan
 * does not include tokens.
 *
 *   fetch(url, { headers: { Authorization: `Bearer ${await getVisitorToken()}` } })
 *
 * It is a JWT signed by the Gatecrypt service, good for a few minutes; call
 * this for every request rather than keeping the answer, and it is fetched
 * again only when the last one is about to run out. Your API checks it with
 * `gatecrypt/server`, or with any JWT library.
 *
 * The service gives a token only while the visitor's address is on the
 * project's access list. Once it says no, the visitor is signed out and the
 * page reloads to the sign-in screen. Throws if the service cannot be reached.
 *
 * With the `api` build option the service worker adds this header by itself,
 * and there is nothing to call.
 */
export async function getVisitorToken(): Promise<string | null> {
  const scope = await scopePath();
  if (scope === undefined) return null;
  const { token, over } = await visitorToken(scope);
  if (over) location.reload();
  return token;
}

/**
 * Forgets the decryption key in this browser and reloads, which lands on the
 * sign-in screen. It does not sign the visitor out of Google.
 */
export async function signOut(): Promise<void> {
  const scope = await scopePath();
  if (scope !== undefined) await clearKey(scope);
  location.reload();
}
