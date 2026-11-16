/**
 * A stand-in for the Gatecrypt service, for developing and testing this
 * package without an account. It speaks PROTOCOL.md and nothing more: one
 * project, kept in memory, with no real identity checks.
 *
 *   - "Google" is a page that asks for an email address and believes it.
 *   - Emailed codes are not sent: they are handed to `onCode` and listed at
 *     GET /__mock.
 *   - Tokens are real: signed with a key made when the mock starts, and
 *     checked like the real ones against GET /v1/jwks.json.
 *
 * Never run it anywhere that matters. It gives the key to anyone who types an
 * allowed address.
 */
import { randomBytes, randomInt, webcrypto } from 'node:crypto';
import { createServer } from 'node:http';

const MESSAGE_TYPE = 'gatecrypt:result';
const KEY_ID = /^[A-Za-z0-9_-]{16,64}$/;
const EC = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGNATURE = { name: 'ECDSA', hash: 'SHA-256' };
/** How long a challenge can be answered, in seconds. */
const CHALLENGE_TTL = 15 * 60;

const { subtle } = webcrypto;
const b64url = (value) => Buffer.from(value).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (title, body) =>
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">` +
  `<title>${escapeHtml(title)}</title><body style="font:16px system-ui;max-width:22rem;margin:3rem auto;padding:0 1rem">${body}</body></html>`;

/**
 * @param {{
 *   port?: number,
 *   projectId?: string,
 *   name?: string,
 *   deployToken?: string,
 *   origins?: string[],
 *   allow?: string[],
 *   onCode?: (code: { email: string, code: string }) => void,
 *   tokenTtl?: number,
 *   grantTtl?: number,
 * }} [options]
 *   `origins` are the site addresses that may sign in. `allow` lists exact
 *   addresses and whole domains ("example.org"). `tokenTtl` and `grantTtl` are
 *   how long a token and a sign-in last, in seconds (ten minutes, thirty days).
 */
export async function startMockService(options = {}) {
  const project = {
    id: options.projectId ?? 'demo',
    name: options.name ?? 'Team handbook',
    deployToken: options.deployToken ?? 'gcd_mock',
    origins: options.origins ?? [],
    allow: options.allow ?? ['alice@example.com', 'example.org'],
    methods: ['google', 'email'],
    heading: null,
    message: null,
    // Whether visitors get tokens at all: the real service ties this to the team's plan.
    tokensIncluded: true,
    tokenTtl: options.tokenTtl ?? 600,
    grantTtl: options.grantTtl ?? 30 * 86400,
  };
  /** keyId -> { key, version } */
  const keys = new Map();
  /** flow -> { email, code, keyId, origin, tries } */
  const flows = new Map();
  /** Every code "sent", newest last. */
  const codes = [];
  /** grant -> { email, origin, pub, signedInAt, expires } */
  const grants = new Map();
  /** challenge -> { grant, expires } */
  const challenges = new Map();
  /** How many tokens have been given out. */
  let tokens = 0;

  // The key tokens are signed with, and its public half as the service publishes it.
  const signing = await subtle.generateKey(EC, true, ['sign', 'verify']);
  const { x, y } = await subtle.exportKey('jwk', signing.publicKey);
  const kid = randomBytes(8).toString('hex');
  const jwks = { keys: [{ kty: 'EC', crv: 'P-256', x, y, kid, alg: 'ES256', use: 'sig' }] };
  /** Set once the server is listening: the `iss` of every token. */
  let issuer = '';

  /** Signs any claims as the service would. Tests use it to make tokens the service never would. */
  const mintToken = async (claims, header = {}) => {
    const input = `${b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid, ...header }))}.${b64url(JSON.stringify(claims))}`;
    return `${input}.${b64url(await subtle.sign(SIGNATURE, signing.privateKey, Buffer.from(input)))}`;
  };

  /** A browser's public signing key as it arrives, or null if it is not one. */
  const devicePub = async (text) => {
    if (typeof text !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(text)) return null;
    return subtle.importKey('raw', Buffer.from(text, 'base64url'), EC, false, ['verify']).catch(() => null);
  };
  const newChallenge = (grant) => {
    const challenge = randomBytes(16).toString('base64url');
    challenges.set(challenge, { grant, expires: now() + CHALLENGE_TTL });
    return challenge;
  };

  const allowed = (email) => project.allow.includes(email) || project.allow.includes(email.split('@')[1]);
  const info = () => ({ name: project.name, origins: project.origins });

  /** The one place a key is handed out. With it goes a grant: what this browser asks for tokens with. */
  const release = (keyId, origin, email, pub) => {
    if (!project.origins.includes(origin)) return { ok: false, error: 'origin_not_registered' };
    if (!allowed(email)) return { ok: false, error: 'not_authorized' };
    const stored = keys.get(keyId);
    if (!stored) return { ok: false, error: 'key_unavailable' };
    if (!project.tokensIncluded) return { ok: true, keyId, key: stored.key, email };
    const grant = randomBytes(32).toString('base64url');
    grants.set(grant, { email, origin, pub, signedInAt: now(), expires: now() + project.grantTtl });
    return { ok: true, keyId, key: stored.key, email, grant };
  };

  const routes = async (req, url, send) => {
    const { pathname, searchParams: query } = url;
    const origin = req.headers.origin ?? '';
    const body = async () => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    };

    // -- for tests: read what was "sent", change the project
    if (pathname === '/__mock') {
      if (req.method === 'POST') Object.assign(project, await body());
      return send(200, { project, codes, keys: [...keys.keys()], tokens });
    }

    // -- for tests: a token with any claims at all, signed with the service's key
    if (pathname === '/__mock/token' && req.method === 'POST') {
      const { claims, header } = await body();
      return send(200, { token: await mintToken(claims ?? {}, header ?? {}) });
    }

    // -- for tests: what a request from a page arrived with
    if (pathname === '/__mock/echo') {
      return send(200, { authorization: req.headers.authorization ?? null }, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' });
    }

    // -- the public keys tokens are checked against
    if (req.method === 'GET' && (pathname === '/v1/jwks.json' || pathname === '/.well-known/jwks.json')) {
      return send(200, jwks, { 'access-control-allow-origin': '*' });
    }
    if (req.method === 'GET' && pathname === '/.well-known/openid-configuration') {
      return send(200, { issuer, jwks_uri: `${issuer}/v1/jwks.json`, id_token_signing_alg_values_supported: ['ES256'] });
    }

    // -- builds
    const build = /^\/v1\/projects\/([^/]+)\/(keys|check)$/.exec(pathname);
    if (build) {
      if (build[1] !== project.id || req.headers.authorization !== `Bearer ${project.deployToken}`) {
        return send(401, { error: 'invalid_token' });
      }
      if (build[2] === 'check' && req.method === 'GET') return send(200, { ok: true, ...info() });
      if (build[2] === 'keys' && req.method === 'POST') {
        const { keyId, key, version } = await body();
        if (typeof keyId !== 'string' || !KEY_ID.test(keyId)) return send(400, { error: 'invalid_key_id' });
        if (typeof key !== 'string' || Buffer.from(key, 'base64url').length !== 32) return send(400, { error: 'invalid_key' });
        const existing = keys.get(keyId);
        if (existing && existing.key !== key) return send(409, { error: 'key_id_conflict' });
        keys.set(keyId, { key, version });
        return send(existing ? 200 : 201, { ok: true, keyId, ...info() });
      }
    }

    // -- the sign-in page's settings
    if (req.method === 'GET' && pathname === `/v1/projects/${project.id}/sign-in`) {
      return send(
        200,
        { methods: project.methods, name: project.name, heading: project.heading, message: project.message, logo: null },
        { 'access-control-allow-origin': '*' },
      );
    }

    // -- "Google": a pop-up that asks who you are, then posts the outcome to the site
    if (req.method === 'GET' && pathname === '/v1/visitor/google') {
      const request = Object.fromEntries(['project', 'keyId', 'origin', 'req', 'pub'].map((name) => [name, query.get(name) ?? '']));
      const pub = await devicePub(request.pub);
      if (request.project !== project.id || !KEY_ID.test(request.keyId) || !request.req || !pub || !project.methods.includes('google')) {
        return send(400, page('Sign-in unavailable', '<p>This sign-in link is not valid.</p>'));
      }
      if (!project.origins.includes(request.origin)) {
        return send(403, page('Sign-in unavailable', `<p>This site (${escapeHtml(request.origin)}) is not registered for this project.</p>`));
      }
      const email = (query.get('email') ?? '').trim().toLowerCase();
      if (!email) {
        const hidden = Object.entries(request)
          .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`)
          .join('');
        return send(
          200,
          page(
            'Mock sign-in',
            `<h1 style="font-size:1.25rem">Mock sign-in</h1><p>Stands in for Google. Type any address; no password.</p>` +
              `<form>${hidden}<input name="email" type="email" required autofocus aria-label="Email" style="font:inherit;width:100%;box-sizing:border-box;padding:.5rem">` +
              `<p><button style="font:inherit;padding:.5rem 1rem">Sign in</button></p></form>`,
          ),
        );
      }
      const decision = release(request.keyId, request.origin, email, pub);
      const message = { type: MESSAGE_TYPE, req: request.req, ...decision };
      return send(
        decision.ok ? 200 : 403,
        page(
          decision.ok ? 'Signed in' : 'Not authorized',
          `<p>${decision.ok ? 'Signed in. This window closes by itself.' : `${escapeHtml(email)} is not authorized to view this site.`}</p>` +
            `<script>if(window.opener){window.opener.postMessage(${JSON.stringify(message).replace(/</g, '\\u003c')},${JSON.stringify(request.origin).replace(/</g, '\\u003c')});${decision.ok ? 'window.close()' : ''}}</script>`,
        ),
      );
    }

    // -- emailed code, and tokens: calls from the site's own page
    if (pathname === '/v1/visitor/email' || pathname === '/v1/visitor/email/verify' || pathname === '/v1/visitor/token') {
      const cors = {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST',
        'access-control-allow-headers': 'Content-Type',
        vary: 'Origin',
      };
      if (req.method === 'OPTIONS') return send(204, '', cors);
      if (req.method !== 'POST') return send(405, { error: 'method_not_allowed' }, cors);
      const input = await body();

      if (pathname === '/v1/visitor/token') {
        // For tests: the service having a bad day.
        if (project.tokensDown) return send(503, { error: 'server_error' }, cors);
        const grant = grants.get(input.grant);
        // A grant is good on the site it was given to, until it runs out.
        if (!grant || grant.origin !== origin || grant.expires <= now()) return send(401, { ok: false, error: 'expired' }, cors);
        // No challenge, or one that is not ours to answer any more: here is one.
        const challenge = challenges.get(input.challenge);
        if (!challenge || challenge.grant !== input.grant || challenge.expires <= now() || typeof input.proof !== 'string') {
          return send(200, { ok: true, challenge: newChallenge(input.grant) }, cors);
        }
        const proved = await subtle
          .verify(SIGNATURE, grant.pub, Buffer.from(input.proof, 'base64url'), Buffer.from(`gatecrypt/v1/token\n${input.grant}\n${input.challenge}`))
          .catch(() => false);
        if (!proved) return send(400, { ok: false, error: 'invalid_proof' }, cors);
        // The lists as they are now, not as they were at sign-in.
        if (!project.origins.includes(origin)) return send(403, { ok: false, error: 'origin_not_registered' }, cors);
        if (!allowed(grant.email)) return send(403, { ok: false, error: 'not_authorized' }, cors);
        if (!project.tokensIncluded) return send(403, { ok: false, error: 'tokens_unavailable' }, cors);
        tokens++;
        const token = await mintToken({
          iss: issuer,
          aud: project.id,
          sub: grant.email,
          email: grant.email,
          email_verified: true,
          origin,
          auth_time: grant.signedInAt,
          iat: now(),
          exp: now() + project.tokenTtl,
        });
        return send(200, { ok: true, token, expiresIn: project.tokenTtl, challenge: newChallenge(input.grant) }, cors);
      }

      if (pathname === '/v1/visitor/email') {
        const pub = await devicePub(input.pub);
        if (input.project !== project.id || typeof input.keyId !== 'string' || !KEY_ID.test(input.keyId) || !pub) {
          return send(400, { ok: false, error: 'invalid_request' }, cors);
        }
        if (!project.origins.includes(origin)) return send(403, { ok: false, error: 'origin_not_registered' }, cors);
        if (!project.methods.includes('email')) return send(403, { ok: false, error: 'method_unavailable' }, cors);
        const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
        if (!/^[^@\s]+@[^@\s]+$/.test(email)) return send(400, { ok: false, error: 'invalid_email' }, cors);
        const flow = randomBytes(32).toString('base64url');
        // An address that is not allowed gets the same answer and no code.
        const code = allowed(email) ? String(randomInt(1_000_000)).padStart(6, '0') : null;
        flows.set(flow, { email, code, keyId: input.keyId, origin, pub, tries: 0 });
        if (code) {
          codes.push({ email, code });
          options.onCode?.({ email, code });
        }
        return send(200, { ok: true, flow }, cors);
      }

      const flow = flows.get(input.flow);
      if (!flow || flow.origin !== origin) return send(400, { ok: false, error: 'expired' }, cors);
      if (!flow.code || String(input.code ?? '').replace(/\s/g, '') !== flow.code) {
        if (++flow.tries < 5) return send(400, { ok: false, error: 'wrong_code' }, cors);
        flows.delete(input.flow);
        return send(400, { ok: false, error: 'too_many_tries' }, cors);
      }
      flows.delete(input.flow);
      const decision = release(flow.keyId, origin, flow.email, flow.pub);
      return send(decision.ok ? 200 : decision.error === 'key_unavailable' ? 400 : 403, decision, cors);
    }

    return send(404, { error: 'not_found' });
  };

  const server = createServer((req, res) => {
    const send = (status, content, headers = {}) => {
      const html = typeof content === 'string';
      res.writeHead(status, {
        'content-type': html ? 'text/html; charset=utf-8' : 'application/json',
        'cache-control': 'no-store',
        ...headers,
      });
      res.end(html ? content : JSON.stringify(content));
    };
    routes(req, new URL(req.url ?? '/', 'http://mock'), send).catch((error) => {
      console.error(error);
      if (!res.headersSent) send(500, { error: 'server_error' });
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, 'localhost', resolve);
  });

  issuer = `http://localhost:${server.address().port}`;

  return {
    url: issuer,
    project,
    codes,
    keys,
    mintToken,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
