import { beforeAll, describe, expect, it } from 'vitest';
import { VisitorTokenError, visitorVerifier, type VerifierOptions } from '../src/server.js';

const SERVICE = 'https://gate.example';
const PROJECT = 'proj-1';
const SITE = 'https://docs.example.com';
const EC = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const b64url = (value: string | ArrayBuffer): string => Buffer.from(value as string).toString('base64url');
const now = (): number => Math.floor(Date.now() / 1000);

interface Signer {
  kid: string;
  jwk: JsonWebKey & { kid: string };
  sign: (claims: Record<string, unknown>, header?: Record<string, unknown>) => Promise<string>;
}

async function signer(kid: string): Promise<Signer> {
  const pair = await crypto.subtle.generateKey(EC, true, ['sign', 'verify']);
  const { x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    kid,
    jwk: { kty: 'EC', crv: 'P-256', x, y, kid, alg: 'ES256', use: 'sig' },
    async sign(claims, header = {}) {
      const input = `${b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid, ...header }))}.${b64url(JSON.stringify(claims))}`;
      const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(input));
      return `${input}.${b64url(signature)}`;
    },
  };
}

const claims = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  iss: SERVICE,
  aud: PROJECT,
  sub: 'ada@example.com',
  email: 'ada@example.com',
  email_verified: true,
  origin: SITE,
  auth_time: now() - 3600,
  iat: now() - 5,
  exp: now() + 600,
  ...overrides,
});

/** A key service that counts how often it is asked, and can be changed or broken between calls. */
function keyService(keys: Signer[]) {
  const service = {
    keys,
    calls: [] as string[],
    down: false,
    fetch: async (url: string): Promise<Response> => {
      service.calls.push(url);
      if (service.down) return new Response('down', { status: 503 });
      return Response.json({ keys: service.keys.map((key) => key.jwk) });
    },
  };
  return service;
}

let service: Signer;
let stranger: Signer;
beforeAll(async () => {
  service = await signer('key-1');
  stranger = await signer('key-1');
});

const verifier = (keys = keyService([service]), options: Partial<VerifierOptions> = {}) =>
  visitorVerifier({ projectId: PROJECT, serviceUrl: SERVICE, fetch: keys.fetch, ...options });

const code = (work: Promise<unknown>): Promise<unknown> =>
  work.then(
    () => 'accepted',
    (error: unknown) => (error instanceof VisitorTokenError ? error.code : error),
  );

describe('visitorVerifier', () => {
  it('says who a token is for', async () => {
    const issued = claims();
    const visitor = await verifier()(await service.sign(issued));
    expect(visitor).toEqual({
      email: 'ada@example.com',
      projectId: PROJECT,
      origin: SITE,
      signedInAt: issued.auth_time,
      issuedAt: issued.iat,
      expiresAt: issued.exp,
      claims: issued,
    });
  });

  it('reads the token from a Fetch request, Fetch headers, or a Node request', async () => {
    const verify = verifier();
    const token = await service.sign(claims());
    const header = { authorization: `Bearer ${token}` };
    expect((await verify(new Request('https://api.example.com/me', { headers: header }))).email).toBe('ada@example.com');
    expect((await verify({ headers: new Headers({ Authorization: `bearer ${token}` }) })).email).toBe('ada@example.com');
    expect((await verify({ headers: header })).email).toBe('ada@example.com');
  });

  it.each([
    ['no header', { headers: {} }],
    ['an empty header', { headers: { authorization: '' } }],
    ['another scheme', { headers: { authorization: 'Basic dXNlcjpwYXNz' } }],
    ['a header given twice', { headers: { authorization: ['Bearer a', 'Bearer b'] } }],
    ['two tokens in one header', { headers: { authorization: 'Bearer a b' } }],
    ['nothing with headers at all', {} as never],
  ])('says a request with %s has no token', async (_case, request) => {
    expect(await code(verifier()(request))).toBe('missing');
  });

  it.each(['', 'nonsense', 'a.b', 'a.b.c.d', '!!.!!.!!', `${b64url('[]')}.${b64url('{}')}.${b64url('x')}`, `${b64url('null')}.${b64url('null')}.sig`])(
    'says %j is not a token, without asking for keys',
    async (token) => {
      const keys = keyService([service]);
      expect(await code(verifier(keys)(token))).toBe('malformed');
      expect(keys.calls).toEqual([]);
    },
  );

  it('accepts only the signing algorithm the service uses', async () => {
    const keys = keyService([service]);
    const verify = verifier(keys);
    const [, body, signature] = (await service.sign(claims())).split('.');
    for (const alg of ['none', 'HS256', 'RS256', 'ES384', 'es256', undefined]) {
      const header = b64url(JSON.stringify({ alg, typ: 'JWT', kid: service.kid }));
      expect(await code(verify(`${header}.${body}.${signature}`)), String(alg)).toBe('malformed');
      expect(await code(verify(`${header}.${body}.`)), String(alg)).toBe('malformed');
    }
    expect(await code(verify(`${b64url(JSON.stringify({ alg: 'ES256' }))}.${body}.${signature}`))).toBe('malformed');
    expect(keys.calls).toEqual([]);
  });

  it('refuses a token that was changed after it was signed, or signed by someone else', async () => {
    const verify = verifier();
    const token = await service.sign(claims());
    const [header, , signature] = token.split('.');
    expect(await code(verify(`${header}.${b64url(JSON.stringify(claims({ email: 'eve@example.com' })))}.${signature}`))).toBe('bad_signature');
    expect(await code(verify(`${header}.${token.split('.')[1]}.${b64url(new Uint8Array(64).buffer)}`))).toBe('bad_signature');
    // The same key id, a different key.
    expect(await code(verify(await stranger.sign(claims())))).toBe('bad_signature');
    expect(await code(verify(await service.sign(claims(), { kid: 'unknown' })))).toBe('bad_signature');
  });

  it('refuses a token for another project, from another service, or with claims missing', async () => {
    const verify = verifier();
    expect(await code(verify(await service.sign(claims({ aud: 'proj-2' }))))).toBe('wrong_audience');
    expect(await code(verify(await service.sign(claims({ aud: [PROJECT, 'proj-2'] }))))).toBe('wrong_audience');
    expect(await code(verify(await service.sign(claims({ iss: 'https://gate.example.evil.test' }))))).toBe('wrong_audience');
    expect(await code(verify(await service.sign(claims({ iss: `${SERVICE}/` }))))).toBe('wrong_audience');
    for (const missing of ['email', 'origin', 'exp', 'iat']) {
      expect(await code(verify(await service.sign(claims({ [missing]: undefined })))), missing).toBe('malformed');
    }
    expect(await code(verify(await service.sign(claims({ exp: String(now() + 600) }))))).toBe('malformed');
  });

  it('refuses a token that has run out, allowing a little for clocks that disagree', async () => {
    const verify = verifier();
    expect(await code(verify(await service.sign(claims({ exp: now() - 31 }))))).toBe('expired');
    expect(await code(verify(await service.sign(claims({ exp: now() - 10 }))))).toBe('accepted');
    expect(await code(verify(await service.sign(claims({ iat: now() + 120 }))))).toBe('malformed');
    expect(await code(verify(await service.sign(claims({ iat: now() + 10 }))))).toBe('accepted');

    const strict = verifier(undefined, { clockTolerance: 0 });
    expect(await code(strict(await service.sign(claims({ exp: now() - 1 }))))).toBe('expired');
  });

  it('can be limited to some of the project\'s site addresses', async () => {
    const verify = verifier(undefined, { origins: [SITE] });
    expect(await code(verify(await service.sign(claims())))).toBe('accepted');
    expect(await code(verify(await service.sign(claims({ origin: 'https://staging.example.com' }))))).toBe('wrong_audience');
  });

  it('fetches the keys once, from the service it was told about, however many tokens it checks', async () => {
    const keys = keyService([service]);
    const verify = verifier(keys);
    await Promise.all([1, 2, 3].map(async () => verify(await service.sign(claims()))));
    await verify(await service.sign(claims()));
    expect(keys.calls).toEqual([`${SERVICE}/v1/jwks.json`]);
  });

  it('defaults to the Gatecrypt service', async () => {
    const keys = keyService([service]);
    const verify = visitorVerifier({ projectId: PROJECT, fetch: keys.fetch });
    await verify(await service.sign(claims({ iss: 'https://api.gatecrypt.dev' })));
    expect(keys.calls).toEqual(['https://api.gatecrypt.dev/v1/jwks.json']);
  });

  it('picks up a key the service starts signing with, without asking again for every unknown one', async () => {
    const keys = keyService([service]);
    const verify = verifier(keys);
    await verify(await service.sign(claims()));
    const next = await signer('key-2');

    // Not published yet: one look, then no more for a while.
    expect(await code(verify(await next.sign(claims())))).toBe('bad_signature');
    expect(keys.calls).toHaveLength(1); // the first fetch was a moment ago, so it does not look again yet
    keys.keys = [service, next];
    expect(await code(verify(await next.sign(claims())))).toBe('bad_signature');

    // Half a minute on, an unknown key id is worth another look.
    const realNow = Date.now;
    Date.now = () => realNow() + 31_000;
    try {
      expect(await code(verify(await next.sign(claims({ iat: now(), exp: now() + 600 }))))).toBe('accepted');
      expect(keys.calls).toHaveLength(2);
      expect(await code(verify(await service.sign(claims({ iat: now(), exp: now() + 600 }))))).toBe('accepted');
    } finally {
      Date.now = realNow;
    }
  });

  it('stops trusting a key the service has withdrawn, within the hour', async () => {
    const keys = keyService([service]);
    const verify = verifier(keys);
    await verify(await service.sign(claims()));
    keys.keys = [await signer('key-2')];
    const realNow = Date.now;
    Date.now = () => realNow() + 61 * 60 * 1000;
    try {
      expect(await code(verify(await service.sign(claims({ iat: now(), exp: now() + 600 }))))).toBe('bad_signature');
    } finally {
      Date.now = realNow;
    }
  });

  it('says so when the keys cannot be fetched, and recovers when they can', async () => {
    const keys = keyService([service]);
    keys.down = true;
    const verify = verifier(keys);
    const token = await service.sign(claims());
    expect(await code(verify(token))).toBe('keys_unavailable');
    keys.down = false;
    expect(await code(verify(token))).toBe('accepted');

    const broken = verifier({ ...keys, fetch: async () => Promise.reject(new Error('offline')) });
    const failure = await broken(token).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(VisitorTokenError);
    expect((failure as VisitorTokenError).message).toContain('offline');

    const empty = verifier({ ...keys, fetch: async () => Response.json({ keys: [{ kty: 'RSA', kid: 'key-1' }] }) });
    expect(await code(empty(token))).toBe('keys_unavailable');
  });

  it('keeps working with the keys it has while the service is briefly unreachable', async () => {
    const keys = keyService([service]);
    const verify = verifier(keys);
    await verify(await service.sign(claims()));
    keys.down = true;
    const realNow = Date.now;
    Date.now = () => realNow() + 61 * 60 * 1000;
    try {
      expect(await code(verify(await service.sign(claims({ iat: now(), exp: now() + 600 }))))).toBe('accepted');
    } finally {
      Date.now = realNow;
    }
  });

  it('insists on a project, and on a service address that is one', () => {
    expect(() => visitorVerifier({} as VerifierOptions)).toThrow('needs a projectId');
    expect(() => visitorVerifier({ projectId: PROJECT, serviceUrl: 'gate.example' })).toThrow('is not a URL');
  });
});
