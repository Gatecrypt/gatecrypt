import { describe, expect, it } from 'vitest';
import { DEVICE_KEY, DEVICE_SIGNATURE, b64urlDecode, proofInput } from '../src/format.js';
import { normalizeApi } from '../src/protect.js';
import { UNAVAILABLE, requestToken, type Fetch } from '../src/token.js';

const SERVICE = 'https://gate.example';

/** A service that answers token requests from a script, and remembers what it was sent. */
function scripted(answers: { status?: number; body: unknown }[]) {
  const sent: { url: string; body: { grant: string; challenge?: string; proof?: string } }[] = [];
  const fetcher: Fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body as string) });
    const next = answers.shift();
    if (!next) throw new Error('no answer scripted');
    return new Response(typeof next.body === 'string' ? next.body : JSON.stringify(next.body), { status: next.status ?? 200 });
  };
  return { sent, fetcher };
}

async function browser() {
  const pair = await crypto.subtle.generateKey(DEVICE_KEY, false, ['sign', 'verify']);
  const proves = (grant: string, challenge: string, proof: string): Promise<boolean> =>
    crypto.subtle.verify(DEVICE_SIGNATURE, pair.publicKey, b64urlDecode(proof), proofInput(grant, challenge));
  return { sign: { service: SERVICE, grant: 'grant-1', signKey: pair.privateKey }, proves };
}

describe('requestToken', () => {
  it('asks for a challenge, signs it, and is given a token', async () => {
    const { sign, proves } = await browser();
    const { sent, fetcher } = scripted([
      { body: { ok: true, challenge: 'c1' } },
      { body: { ok: true, token: 'jwt', expiresIn: 600, challenge: 'c2' } },
    ]);
    expect(await requestToken(sign, undefined, fetcher)).toEqual({ token: 'jwt', expiresIn: 600, challenge: 'c2' });
    expect(sent.map((request) => request.url)).toEqual([`${SERVICE}/v1/visitor/token`, `${SERVICE}/v1/visitor/token`]);
    expect(sent[0]!.body).toEqual({ grant: 'grant-1' });
    expect(sent[1]!.body).toMatchObject({ grant: 'grant-1', challenge: 'c1' });
    expect(await proves('grant-1', 'c1', sent[1]!.body.proof!)).toBe(true);
    // The proof is for this grant and this challenge, and no other.
    expect(await proves('grant-1', 'c2', sent[1]!.body.proof!)).toBe(false);
    expect(await proves('grant-2', 'c1', sent[1]!.body.proof!)).toBe(false);
  });

  it('answers the challenge it kept from last time in one request', async () => {
    const { sign, proves } = await browser();
    const { sent, fetcher } = scripted([{ body: { ok: true, token: 'jwt', expiresIn: 600 } }]);
    expect(await requestToken(sign, 'kept', fetcher)).toEqual({ token: 'jwt', expiresIn: 600, challenge: undefined });
    expect(sent).toHaveLength(1);
    expect(await proves('grant-1', 'kept', sent[0]!.body.proof!)).toBe(true);
  });

  it('signs a new challenge when the one it kept is too old', async () => {
    const { sign, proves } = await browser();
    const { sent, fetcher } = scripted([
      { body: { ok: true, challenge: 'fresh' } },
      { body: { ok: true, token: 'jwt', expiresIn: 600, challenge: 'next' } },
    ]);
    expect(await requestToken(sign, 'stale', fetcher)).toMatchObject({ token: 'jwt' });
    expect(await proves('grant-1', 'fresh', sent[1]!.body.proof!)).toBe(true);
  });

  it.each([
    [401, 'expired'],
    [403, 'not_authorized'],
    [403, 'origin_not_registered'],
    [400, 'invalid_proof'],
  ])('answers null when the service says no (%i %s)', async (status, error) => {
    const { sign } = await browser();
    expect(await requestToken(sign, undefined, scripted([{ status, body: { ok: false, error } }]).fetcher)).toBeNull();
    expect(
      await requestToken(sign, undefined, scripted([{ body: { ok: true, challenge: 'c' } }, { status, body: { ok: false, error } }]).fetcher),
    ).toBeNull();
  });

  it('says so when the project\'s visitors get no tokens, which is not a refusal of this visitor', async () => {
    const { sign } = await browser();
    const answer = { status: 403, body: { ok: false, error: 'tokens_unavailable' } };
    expect(await requestToken(sign, undefined, scripted([answer]).fetcher)).toBe(UNAVAILABLE);
    expect(await requestToken(sign, 'kept', scripted([answer]).fetcher)).toBe(UNAVAILABLE);
  });

  it.each([
    ['a server error', { status: 500, body: { error: 'server_error' } }],
    ['too many requests', { status: 429, body: { ok: false, error: 'slow_down' } }],
    ['an answer that is not JSON', { status: 502, body: '<html>bad gateway</html>' }],
    ['a refusal status without a refusal', { status: 403, body: '<html>blocked by a proxy</html>' }],
    ['an OK with nothing in it', { status: 200, body: { ok: true } }],
    ['a token without a lifetime', { status: 200, body: { ok: true, token: 'jwt' } }],
  ])('throws, and does not end the sign-in, on %s', async (_case, answer) => {
    const { sign } = await browser();
    await expect(requestToken(sign, undefined, scripted([answer]).fetcher)).rejects.toThrow('did not give a token');
  });

  it('throws when the service cannot be reached, or keeps asking for another proof', async () => {
    const { sign } = await browser();
    await expect(requestToken(sign, undefined, async () => Promise.reject(new TypeError('offline')))).rejects.toThrow('offline');
    const endless = scripted([{ body: { ok: true, challenge: 'a' } }, { body: { ok: true, challenge: 'b' } }, { body: { ok: true, challenge: 'c' } }]);
    await expect(requestToken(sign, undefined, endless.fetcher)).rejects.toThrow('did not give a token');
    expect(endless.sent).toHaveLength(2);
  });
});

describe('the api option', () => {
  it('takes an address, with or without a path, and a path on the site itself', () => {
    expect(normalizeApi('https://api.example.com')).toBe('https://api.example.com');
    expect(normalizeApi('https://API.example.com/')).toBe('https://api.example.com');
    expect(normalizeApi('https://api.example.com:8443/v1')).toBe('https://api.example.com:8443/v1');
    expect(normalizeApi('http://localhost:8080')).toBe('http://localhost:8080');
    expect(normalizeApi('http://127.0.0.1:8080/api')).toBe('http://127.0.0.1:8080/api');
    expect(normalizeApi('/api')).toBe('/api');
    expect(normalizeApi('/')).toBe('/');
  });

  it.each([
    ['', 'is empty'],
    ['api.example.com', 'is neither'],
    ['http://api.example.com', 'must be https'],
    ['ftp://api.example.com', 'must be https'],
    ['https://*.example.com', 'has more than'],
    ['https://api.example.com/v1?key=1', 'has more than'],
    ['https://api.example.com/#x', 'has more than'],
    ['https://user:pass@api.example.com', 'has more than'],
    ['//evil.test/api', 'is not a plain path'],
    ['/api?x=1', 'is not a plain path'],
    ['/api/*', 'is not a plain path'],
    ['/a pi', 'is not a plain path'],
  ])('refuses %j', (entry, why) => {
    expect(() => normalizeApi(entry)).toThrow(why);
    expect(() => normalizeApi(entry)).toThrow('api must be an address like');
  });
});
