/**
 * The visitor's token: a short-lived, signed statement of who the visitor is,
 * for the site's own API to check. Shared by `gatecrypt/client` and the
 * service worker. See PROTOCOL.md, "Tokens".
 *
 * A sign-in leaves two things in this browser besides the key: a grant from
 * the service, and a signing key the browser made itself and cannot export.
 * A token is given to whoever shows the grant and signs the service's
 * challenge with that key, for as long as the address is on the access list.
 */
import { API, DEVICE_SIGNATURE, b64urlEncode, proofInput } from './format.js';
import { clearKey, getKey, getToken, putToken, type KeyRecord } from './idb.js';

export interface TokenAnswer {
  token: string;
  /** Seconds the token is good for. */
  expiresIn: number;
  /** The challenge to answer next time. */
  challenge?: string;
}

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** The service has tokens for nobody on this project: there is none to be had, and nothing is wrong with the sign-in. */
export const UNAVAILABLE = 'unavailable';

/**
 * Asks the service for a token. Null means the service has said no: the
 * sign-in has run out, or the visitor is no longer allowed. UNAVAILABLE means
 * this project's visitors get no tokens at all. Throws when there was no clear
 * answer (offline, or the service is down).
 */
export async function requestToken(
  sign: { service: string; grant: string; signKey: CryptoKey },
  challenge?: string,
  fetcher: Fetch = fetch,
): Promise<TokenAnswer | typeof UNAVAILABLE | null> {
  // At most twice: once with the challenge kept from last time, once with the one the service sets.
  for (let round = 0; round < 2; round++) {
    const proof = challenge
      ? b64urlEncode(new Uint8Array(await crypto.subtle.sign(DEVICE_SIGNATURE, sign.signKey, proofInput(sign.grant, challenge))))
      : undefined;
    const res = await fetcher(`${sign.service}${API}/visitor/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant: sign.grant, challenge, proof }),
      signal: AbortSignal.timeout(15000),
    });
    const answer = (await res.json().catch(() => undefined)) as Record<string, unknown> | undefined;
    if (res.ok && typeof answer?.token === 'string' && typeof answer.expiresIn === 'number') {
      return {
        token: answer.token,
        expiresIn: answer.expiresIn,
        challenge: typeof answer.challenge === 'string' ? answer.challenge : undefined,
      };
    }
    if (res.ok && typeof answer?.challenge === 'string') {
      challenge = answer.challenge;
      continue;
    }
    if (answer?.ok === false && (res.status === 400 || res.status === 401 || res.status === 403)) {
      return answer.error === 'tokens_unavailable' ? UNAVAILABLE : null;
    }
    break;
  }
  throw new Error('Gatecrypt: the sign-in service did not give a token');
}

/** How long before a token runs out it stops being handed out, in seconds. */
const MARGIN = 60;

export interface TokenResult {
  /** Null when nobody is signed in here, or the sign-in has just been ended. */
  token: string | null;
  /** The service said no, and the sign-in in this browser has been forgotten. */
  over: boolean;
}

const pending = new Map<string, Promise<TokenResult>>();
/** Grants the service has just said earn no tokens, and until when not to ask again (milliseconds). */
const unavailable = new Map<string, number>();

/**
 * The visitor's token for the site under `scopePath`, from the copy kept in
 * this browser while that is fresh, otherwise from the service.
 */
export function visitorToken(scopePath: string): Promise<TokenResult> {
  let work = pending.get(scopePath);
  if (!work) {
    work = load(scopePath).finally(() => pending.delete(scopePath));
    pending.set(scopePath, work);
  }
  return work;
}

async function load(scopePath: string): Promise<TokenResult> {
  const record: KeyRecord | undefined = await getKey(scopePath);
  const { service, grant, signKey } = record ?? {};
  if (!service || !grant || !signKey) return { token: null, over: false };

  let kept = await getToken(scopePath).catch(() => undefined);
  if (kept?.grant !== grant) kept = undefined;
  if (kept?.token && kept.until && Date.now() < kept.until) return { token: kept.token, over: false };

  if (Date.now() < (unavailable.get(grant) ?? 0)) return { token: null, over: false };
  const answer = await requestToken({ service, grant, signKey }, kept?.challenge);
  if (answer === UNAVAILABLE) {
    // Not worth asking again for every call the site makes.
    unavailable.set(grant, Date.now() + MARGIN * 1000);
    return { token: null, over: false };
  }
  if (!answer) {
    await clearKey(scopePath);
    return { token: null, over: true };
  }
  await putToken(scopePath, {
    grant,
    token: answer.token,
    until: Date.now() + (answer.expiresIn - Math.min(MARGIN, answer.expiresIn / 2)) * 1000,
    challenge: answer.challenge,
  }).catch(() => undefined);
  return { token: answer.token, over: false };
}
