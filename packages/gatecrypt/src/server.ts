/**
 * For your own API: checks the token a signed-in visitor's requests carry.
 *
 *   import { visitorVerifier } from 'gatecrypt/server';
 *
 *   const verify = visitorVerifier({ projectId: 'YOUR_PROJECT_ID' });
 *   const visitor = await verify(request);   // { email, ... }, or it throws
 *
 * The token is a JWT signed by the Gatecrypt service (ES256). It is checked
 * here, on your server, against the service's public keys, which are fetched
 * once and kept; no request is made per token. Runs wherever `fetch` and
 * WebCrypto do: Node 20+, Cloudflare Workers, Deno, Bun. It imports nothing.
 *
 * A token says that, a few minutes ago at most, the service found this address
 * on the project's access list. What the visitor may do in your API is yours
 * to decide.
 */

export interface VerifierOptions {
  /** Project ID from the Gatecrypt dashboard. Tokens for any other project are refused. */
  projectId: string;
  /** Origin of the Gatecrypt service. Default: https://api.gatecrypt.dev. */
  serviceUrl?: string;
  /**
   * Accept tokens only from these site addresses (origins), such as
   * "https://docs.example.com". Default: any of the project's site addresses.
   */
  origins?: string[];
  /** Seconds of difference between this machine's clock and the service's to allow for. Default 30. */
  clockTolerance?: number;
  /** Used to fetch the service's public keys. Default: the global `fetch`. */
  fetch?: (url: string) => Promise<Response>;
}

/** Who a token is for. */
export interface VerifiedVisitor {
  /** The address the visitor signed in with, lower-cased. */
  email: string;
  /** The project the token is for. */
  projectId: string;
  /** The site address (origin) the visitor signed in on. */
  origin: string;
  /** When the visitor signed in, in seconds since 1970. */
  signedInAt: number;
  /** When this token was made, in seconds since 1970. */
  issuedAt: number;
  /** When this token stops being accepted, in seconds since 1970. */
  expiresAt: number;
  /** Every claim in the token. */
  claims: Record<string, unknown>;
}

export type VisitorTokenErrorCode =
  /** The request carries no token. */
  | 'missing'
  /** Not a token of the kind the service makes. */
  | 'malformed'
  /** Not signed by the service. */
  | 'bad_signature'
  /** Too old. The site fetches a new one by itself; the request can be tried again. */
  | 'expired'
  /** Made for another project, by another service, or on a site address that is not accepted. */
  | 'wrong_audience'
  /** The service's public keys could not be fetched. Not the visitor's fault: answer 503, not 401. */
  | 'keys_unavailable';

export class VisitorTokenError extends Error {
  readonly code: VisitorTokenErrorCode;
  constructor(code: VisitorTokenErrorCode, message: string) {
    super(message);
    this.name = 'VisitorTokenError';
    this.code = code;
  }
}

/** A token, or something that carries one in an `Authorization: Bearer` header. */
export type TokenSource =
  | string
  | { headers: { get(name: string): string | null } | Record<string, string | string[] | undefined> };

const DEFAULT_SERVICE_URL = 'https://api.gatecrypt.dev';
/** Keys are fetched again after this long, so that one the service has withdrawn stops being trusted. */
const KEYS_MAX_AGE_MS = 60 * 60 * 1000;
/** How often an unknown key id may send us back to the service. */
const KEYS_RETRY_MS = 30 * 1000;

interface Jwk {
  kty?: string;
  crv?: string;
  kid?: string;
  x?: string;
  y?: string;
}

const decoder = new TextDecoder();

function b64url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new Error('not base64url');
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function bearer(source: TokenSource): string {
  if (typeof source === 'string') return source;
  const headers = source?.headers as
    | { get?: (name: string) => string | null }
    | Record<string, string | string[] | undefined>
    | undefined;
  const value =
    typeof headers?.get === 'function'
      ? headers.get('authorization')
      : (headers as Record<string, string | string[] | undefined> | undefined)?.authorization;
  const match = /^Bearer +([^\s]+)$/i.exec(typeof value === 'string' ? value.trim() : '');
  if (!match) throw new VisitorTokenError('missing', 'The request has no "Authorization: Bearer" token');
  return match[1]!;
}

/**
 * Makes the function that checks tokens for one project. Make it once, when
 * your server starts, and call it for every request: it keeps the service's
 * public keys between calls.
 *
 * The function takes a token, or a request (a Fetch `Request`, or Node's
 * `IncomingMessage`) with the token in its `Authorization: Bearer` header. It
 * resolves to who the visitor is, or rejects with a `VisitorTokenError`.
 */
export function visitorVerifier(options: VerifierOptions): (source: TokenSource) => Promise<VerifiedVisitor> {
  const { projectId, origins, clockTolerance = 30 } = options;
  if (!projectId || typeof projectId !== 'string') throw new Error('Gatecrypt: visitorVerifier needs a projectId');
  let issuer: string;
  try {
    issuer = new URL(options.serviceUrl || DEFAULT_SERVICE_URL).origin;
  } catch {
    throw new Error(`Gatecrypt: serviceUrl "${options.serviceUrl}" is not a URL`);
  }
  const fetcher = options.fetch ?? ((url: string) => fetch(url));

  let keys = new Map<string, CryptoKey>();
  let fetchedAt = 0;
  let fetching: Promise<void> | undefined;

  const fetchKeys = (): Promise<void> =>
    (fetching ??= (async () => {
      try {
        const res = await fetcher(`${issuer}/v1/jwks.json`);
        if (!res.ok) throw new Error(`${res.status}`);
        const body = (await res.json()) as { keys?: Jwk[] };
        const next = new Map<string, CryptoKey>();
        for (const jwk of Array.isArray(body.keys) ? body.keys : []) {
          if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.kid !== 'string' || !jwk.x || !jwk.y) continue;
          next.set(
            jwk.kid,
            await crypto.subtle.importKey(
              'jwk',
              { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
              { name: 'ECDSA', namedCurve: 'P-256' },
              false,
              ['verify'],
            ),
          );
        }
        if (next.size === 0) throw new Error('no usable keys');
        keys = next;
      } catch (error) {
        throw new VisitorTokenError(
          'keys_unavailable',
          `Could not fetch the public keys of ${issuer}: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        fetchedAt = Date.now();
        fetching = undefined;
      }
    })());

  async function keyFor(kid: string): Promise<CryptoKey | undefined> {
    const age = Date.now() - fetchedAt;
    // Fetch when there are none, when they are old, or when this one is new to us (and we have not just looked).
    if (keys.size === 0 || age > KEYS_MAX_AGE_MS || (!keys.has(kid) && age > KEYS_RETRY_MS)) {
      // Old keys are still good enough if the service cannot be reached for a moment.
      await fetchKeys().catch((error: unknown) => {
        if (!keys.has(kid)) throw error;
      });
    }
    return keys.get(kid);
  }

  return async function verify(source: TokenSource): Promise<VerifiedVisitor> {
    const token = bearer(source);
    const parts = token.split('.');
    let header: { alg?: unknown; kid?: unknown };
    let claims: Record<string, unknown>;
    let signature: Uint8Array<ArrayBuffer>;
    try {
      if (parts.length !== 3) throw new Error('not three parts');
      header = JSON.parse(decoder.decode(b64url(parts[0]!))) as typeof header;
      claims = JSON.parse(decoder.decode(b64url(parts[1]!))) as typeof claims;
      signature = b64url(parts[2]!);
      if (!header || typeof header !== 'object' || !claims || typeof claims !== 'object' || Array.isArray(claims)) {
        throw new Error('not objects');
      }
    } catch {
      throw new VisitorTokenError('malformed', 'The token is not a JWT');
    }
    // Only the algorithm the service uses: a token that names another one (or none) is not ours.
    if (header.alg !== 'ES256' || typeof header.kid !== 'string' || signature.length !== 64) {
      throw new VisitorTokenError('malformed', 'The token is not signed the way Gatecrypt signs');
    }
    const key = await keyFor(header.kid);
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    if (!key || !(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, signed))) {
      throw new VisitorTokenError('bad_signature', 'The token was not signed by the Gatecrypt service');
    }

    const { iss, aud, email, origin, exp, iat, auth_time: authTime } = claims;
    if (iss !== issuer) throw new VisitorTokenError('wrong_audience', `The token is from ${String(iss)}, not ${issuer}`);
    if (aud !== projectId) throw new VisitorTokenError('wrong_audience', 'The token is for another project');
    if (typeof email !== 'string' || !email || typeof origin !== 'string' || typeof exp !== 'number' || typeof iat !== 'number') {
      throw new VisitorTokenError('malformed', 'The token lacks a claim every Gatecrypt token has');
    }
    if (origins && !origins.includes(origin)) {
      throw new VisitorTokenError('wrong_audience', `The token was given to ${origin}, which is not accepted here`);
    }
    const now = Date.now() / 1000;
    if (exp <= now - clockTolerance) throw new VisitorTokenError('expired', 'The token has expired');
    if (iat > now + clockTolerance) throw new VisitorTokenError('malformed', 'The token is dated in the future');
    return {
      email,
      projectId,
      origin,
      signedInAt: typeof authTime === 'number' ? authTime : iat,
      issuedAt: iat,
      expiresAt: exp,
      claims,
    };
  };
}
