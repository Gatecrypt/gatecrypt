/**
 * A visitor without a browser, for testing an API that checks visitor tokens:
 * signs in to a Gatecrypt service the way the sign-in page does (PROTOCOL.md),
 * with an emailed code, and asks for tokens the way a signed-in site does.
 *
 *   const visitor = await signIn({ serviceUrl, projectId, keyId, origin, email, readCode });
 *   const { token } = await visitor.token();
 *
 * It shares no code with the package, so it also checks the package against
 * the protocol as written.
 */
import { randomBytes, webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const EC = { name: 'ECDSA', namedCurve: 'P-256' };

async function post(serviceUrl, path, origin, body) {
  const res = await fetch(serviceUrl + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/**
 * Registers a fresh key for a build that does not exist, as a build would.
 * Returns its id: a sign-in needs one to ask for.
 * @param {{ serviceUrl: string, projectId: string, deployToken: string }} options
 */
export async function registerBuild({ serviceUrl, projectId, deployToken }) {
  const keyId = randomBytes(16).toString('base64url');
  const res = await fetch(`${serviceUrl}/v1/projects/${projectId}/keys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${deployToken}` },
    body: JSON.stringify({ keyId, key: randomBytes(32).toString('base64url'), version: '0.0.0' }),
  });
  if (!res.ok) throw new Error(`could not register a key: ${res.status} ${await res.text()}`);
  return keyId;
}

/** The newest code the mock service "sent" to an address. */
export async function mockCode(serviceUrl, email) {
  const { codes } = await (await fetch(`${serviceUrl}/__mock`)).json();
  const found = codes.findLast((sent) => sent.email === email);
  if (!found) throw new Error(`no code was sent to ${email}`);
  return found.code;
}

/**
 * Signs in with an emailed code.
 * @param {{
 *   serviceUrl: string, projectId: string, keyId: string, origin: string, email: string,
 *   readCode?: (email: string) => Promise<string>,
 * }} options
 *   `origin` is the site the visitor is on: one of the project's site addresses.
 *   `readCode` fetches the code that was emailed. Default: ask the mock service.
 */
export async function signIn({ serviceUrl, projectId, keyId, origin, email, readCode = (to) => mockCode(serviceUrl, to) }) {
  // The browser's own signing key. The service is told its public half.
  const pair = await subtle.generateKey(EC, false, ['sign']);
  const pub = Buffer.from(await subtle.exportKey('raw', pair.publicKey)).toString('base64url');

  const asked = await post(serviceUrl, '/v1/visitor/email', origin, { project: projectId, keyId, email, pub });
  if (!asked.body.flow) throw new Error(`no code could be asked for: ${asked.status} ${JSON.stringify(asked.body)}`);
  const answer = await post(serviceUrl, '/v1/visitor/email/verify', origin, { flow: asked.body.flow, code: await readCode(email) });
  if (!answer.body.ok) throw new Error(`sign-in was refused: ${answer.status} ${JSON.stringify(answer.body)}`);
  const { grant, key } = answer.body;

  let challenge;
  return {
    email: answer.body.email,
    /** The site's decryption key, base64url. */
    key,
    grant,
    /**
     * Asks for a token. Resolves to `{ token, expiresIn }`, or to the service's
     * refusal `{ ok: false, error }`.
     */
    async token() {
      for (let round = 0; round < 2; round++) {
        const proof = challenge
          ? Buffer.from(
              await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(`gatecrypt/v1/token\n${grant}\n${challenge}`)),
            ).toString('base64url')
          : undefined;
        const res = await post(serviceUrl, '/v1/visitor/token', origin, { grant, challenge, proof });
        challenge = res.body.challenge;
        if (res.body.token || !res.body.ok) return res.body;
      }
      throw new Error('the service kept asking for another proof');
    },
  };
}
