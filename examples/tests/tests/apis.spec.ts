/**
 * Every example API, written five ways and in two languages, is asked the
 * same questions. None of this needs a browser: the visitor is dev/visitor.mjs,
 * which signs in to the mock service and asks it for tokens as a site would.
 */
import { webcrypto } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { registerBuild, signIn } from '../../../dev/visitor.mjs';
import { APIS, ELSEWHERE, PROJECT, SERVICE, available, url } from '../env.ts';

const b64url = (value: string | ArrayBuffer): string => Buffer.from(value as string).toString('base64url');
const now = (): number => Math.floor(Date.now() / 1000);
const EMAIL = 'api-visitor@example.org';

/** A token the mock signs with its real key, whatever the claims: for tokens the service would never make. */
async function mint(claims: Record<string, unknown>, header: Record<string, unknown> = {}): Promise<string> {
  const res = await fetch(`${SERVICE}/__mock/token`, { method: 'POST', body: JSON.stringify({ claims, header }) });
  return ((await res.json()) as { token: string }).token;
}

const good = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  iss: SERVICE,
  aud: PROJECT.id,
  sub: EMAIL,
  email: EMAIL,
  email_verified: true,
  origin: ELSEWHERE,
  auth_time: now() - 60,
  iat: now() - 5,
  exp: now() + 600,
  ...overrides,
});

let visitor: Awaited<ReturnType<typeof signIn>>;
let token: string;
test.beforeAll(async () => {
  const keyId = await registerBuild({ serviceUrl: SERVICE, projectId: PROJECT.id, deployToken: PROJECT.deployToken });
  visitor = await signIn({ serviceUrl: SERVICE, projectId: PROJECT.id, keyId, origin: ELSEWHERE, email: EMAIL });
  ({ token } = (await visitor.token()) as { token: string });
  expect(token).toBeTruthy();
});

for (const api of APIS) {
  test.describe(`the ${api.name} API`, () => {
    test.skip(!available(api), `needs ${api.needs} on the PATH`);
    const me = `${url(api.port)}/api/me`;
    const ask = (authorization?: string): Promise<Response> => fetch(me, { headers: authorization ? { authorization } : {} });
    const status = async (bearer: string): Promise<number> => (await ask(`Bearer ${bearer}`)).status;

    test('knows who a signed-in visitor is', async () => {
      const res = await ask(`Bearer ${token}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { email: string; origin: string; expiresAt: number };
      expect(body).toMatchObject({ email: EMAIL, origin: ELSEWHERE });
      expect(body.expiresAt).toBeGreaterThan(now());
      expect(body.expiresAt).toBeLessThanOrEqual(now() + 600);
      // A token the service was asked for again is as good.
      expect(await status(((await visitor.token()) as { token: string }).token)).toBe(200);
    });

    test('lets a site on another origin call it with an Authorization header', async () => {
      const preflight = await fetch(me, {
        method: 'OPTIONS',
        headers: { origin: 'https://docs.example.com', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
      });
      expect(preflight.status).toBeLessThan(300);
      expect(['*', 'https://docs.example.com']).toContain(preflight.headers.get('access-control-allow-origin'));
      expect(preflight.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
      const res = await fetch(me, { headers: { origin: 'https://docs.example.com', authorization: `Bearer ${token}` } });
      expect(['*', 'https://docs.example.com']).toContain(res.headers.get('access-control-allow-origin'));
    });

    test('refuses a request with no token, or with something that is not one', async () => {
      expect((await ask()).status).toBe(401);
      expect((await ask('Basic dXNlcjpwYXNz')).status).toBe(401);
      expect((await ask(token)).status).toBe(401);
      for (const junk of ['x', 'a.b.c', `${token}x`, token.split('.').slice(0, 2).join('.'), `${token.split('.').slice(0, 2).join('.')}.`]) {
        expect(await status(junk), junk.slice(-12)).toBe(401);
      }
    });

    test('refuses a token whose claims were changed after it was signed', async () => {
      const [header, , signature] = token.split('.');
      const forged = `${header}.${b64url(JSON.stringify(good({ email: 'boss@example.org', sub: 'boss@example.org' })))}.${signature}`;
      expect(await status(forged)).toBe(401);
    });

    test('refuses a token for another project, or from another service', async () => {
      expect(await status(await mint(good()))).toBe(200);
      expect(await status(await mint(good({ aud: 'another-project' })))).toBe(401);
      expect(await status(await mint(good({ aud: ['another-project', PROJECT.id] })))).toBe(401);
      expect(await status(await mint(good({ aud: undefined })))).toBe(401);
      expect(await status(await mint(good({ iss: 'https://api.gatecrypt.dev' })))).toBe(401);
      expect(await status(await mint(good({ iss: `${SERVICE}.evil.test` })))).toBe(401);
    });

    test('refuses a token that has run out', async () => {
      expect(await status(await mint(good({ iat: now() - 900, exp: now() - 300 })))).toBe(401);
      expect(await status(await mint(good({ exp: undefined })))).toBe(401);
    });

    test('refuses a token signed with any key but the service\'s, whatever it claims about itself', async () => {
      const { keys } = (await (await fetch(`${SERVICE}/v1/jwks.json`)).json()) as { keys: (JsonWebKey & { kid: string })[] };
      const jwk = keys[0]!;
      const body = b64url(JSON.stringify(good()));
      const head = (header: Record<string, unknown>): string => b64url(JSON.stringify({ typ: 'JWT', kid: jwk.kid, ...header }));

      // Someone else's key, under the service's key id.
      const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
      const input = `${head({ alg: 'ES256' })}.${body}`;
      const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(input));
      expect(await status(`${input}.${b64url(signature)}`)).toBe(401);

      // No signature at all.
      expect(await status(`${head({ alg: 'none' })}.${body}.`)).toBe(401);

      // The service's public key, used as if it were a shared secret.
      for (const secret of [JSON.stringify(jwk), `${jwk.x}${jwk.y}`]) {
        const hmacKey = await webcrypto.subtle.importKey('raw', Buffer.from(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const hmacInput = `${head({ alg: 'HS256' })}.${body}`;
        expect(await status(`${hmacInput}.${b64url(await webcrypto.subtle.sign('HMAC', hmacKey, Buffer.from(hmacInput)))}`)).toBe(401);
      }

      // A real signature, a header that names a key the service does not have.
      expect(await status(await mint(good(), { kid: 'no-such-key' }))).toBe(401);
    });

    test('answers only what it serves', async () => {
      expect((await fetch(`${url(api.port)}/api/nothing-here`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
    });
  });
}

test('the service gives no token to someone taken off the access list, and their old one runs out', async () => {
  const email = `leaver-${Math.random().toString(36).slice(2, 8)}@partner.test`;
  const allow = ['alice@example.com', 'example.org'];
  const patch = (project: Record<string, unknown>): Promise<Response> => fetch(`${SERVICE}/__mock`, { method: 'POST', body: JSON.stringify(project) });
  try {
    await patch({ allow: [...allow, email], tokenTtl: 2 });
    const keyId = await registerBuild({ serviceUrl: SERVICE, projectId: PROJECT.id, deployToken: PROJECT.deployToken });
    const leaver = await signIn({ serviceUrl: SERVICE, projectId: PROJECT.id, keyId, origin: ELSEWHERE, email });
    const first = (await leaver.token()) as { token: string; expiresIn: number };
    expect(first.expiresIn).toBe(2);

    await patch({ allow });
    expect(await leaver.token()).toEqual({ ok: false, error: 'not_authorized' });
    // The token they already hold lasts as long as it says and no longer.
    const { exp } = JSON.parse(Buffer.from(first.token.split('.')[1]!, 'base64url').toString()) as { exp: number };
    expect(exp - now()).toBeLessThanOrEqual(2);
  } finally {
    await patch({ allow, tokenTtl: 600 });
  }
});

test('a grant is no use without the browser key it was given to, or on another site', async () => {
  const keyId = await registerBuild({ serviceUrl: SERVICE, projectId: PROJECT.id, deployToken: PROJECT.deployToken });
  const victim = await signIn({ serviceUrl: SERVICE, projectId: PROJECT.id, keyId, origin: ELSEWHERE, email: 'victim@example.org' });
  const post = async (origin: string, body: unknown): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${SERVICE}/v1/visitor/token`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };

  // The grant alone earns a challenge, never a token.
  const asked = await post(ELSEWHERE, { grant: victim.grant });
  expect(asked.body).toEqual({ ok: true, challenge: expect.any(String) });
  const challenge = asked.body.challenge as string;

  // Signed by another key: refused.
  const thief = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const proof = b64url(
    await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, thief.privateKey, Buffer.from(`gatecrypt/v1/token\n${victim.grant}\n${challenge}`)),
  );
  expect(await post(ELSEWHERE, { grant: victim.grant, challenge, proof })).toMatchObject({ status: 400, body: { ok: false, error: 'invalid_proof' } });
  // Unsigned, or with a challenge made up: another challenge, still no token.
  expect((await post(ELSEWHERE, { grant: victim.grant, challenge })).body.token).toBeUndefined();
  expect((await post(ELSEWHERE, { grant: victim.grant, challenge: 'made-up', proof })).body.token).toBeUndefined();
  // From a site other than the one that signed in.
  expect(await post('https://evil.test', { grant: victim.grant })).toMatchObject({ status: 401, body: { ok: false, error: 'expired' } });
  expect(await post(ELSEWHERE, { grant: 'made-up' })).toMatchObject({ status: 401, body: { ok: false, error: 'expired' } });

  // The real browser still gets one.
  expect(((await victim.token()) as { token?: string }).token).toBeTruthy();
});
