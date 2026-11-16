/**
 * Key storage. One database per service-worker scope, so two Gatecrypt sites
 * under different paths of the same origin do not overwrite each other's key.
 * (They can still read each other's: IndexedDB is per origin. See README.)
 */

export interface KeyRecord {
  keyId: string;
  projectId: string;
  /** Non-extractable AES-GCM key; structured-cloneable, so it can live in IndexedDB. */
  key: CryptoKey;
  /** The address the visitor signed in with. */
  email?: string;
  /** The service that gave the key, and that gives this sign-in its tokens. */
  service?: string;
  /** What the service gave with the key: shown to it again, with a proof, to be given a token. Opaque. */
  grant?: string;
  /** This browser's own signing key (non-extractable), which makes those proofs. */
  signKey?: CryptoKey;
}

/** The visitor's current token, kept so that a reload does not ask for a new one. */
export interface TokenRecord {
  /** The grant it was given for: a token from an earlier sign-in is never used. */
  grant: string;
  token?: string;
  /** When to stop using it, on this browser's clock (milliseconds). */
  until?: number;
  /** The challenge to answer next time. */
  challenge?: string;
}

const STORE = 'keys';
const ID = 'current';
const TOKEN = 'token';

function open(scopePath: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`gatecrypt:${scopePath}`, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  scopePath: string,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open(scopePath);
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const getKey = (scopePath: string): Promise<KeyRecord | undefined> =>
  run<KeyRecord | undefined>(scopePath, 'readonly', (s) => s.get(ID));

export const putKey = (scopePath: string, record: KeyRecord): Promise<unknown> =>
  run(scopePath, 'readwrite', (s) => s.put(record, ID));

/** Forgets the sign-in: the key, and the token that came with it. */
export const clearKey = (scopePath: string): Promise<unknown> =>
  run(scopePath, 'readwrite', (s) => (s.delete(TOKEN), s.delete(ID)));

export const getToken = (scopePath: string): Promise<TokenRecord | undefined> =>
  run<TokenRecord | undefined>(scopePath, 'readonly', (s) => s.get(TOKEN));

export const putToken = (scopePath: string, record: TokenRecord): Promise<unknown> =>
  run(scopePath, 'readwrite', (s) => s.put(record, TOKEN));
