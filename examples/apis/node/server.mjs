/**
 * An API for a site protected by Gatecrypt, in plain Node.
 *
 * The site's requests carry the visitor's token (the `api` build option makes
 * the service worker add it). This server checks it and so knows, without a
 * session or a database of its own, which person on the access list is asking.
 *
 *   GATECRYPT_PROJECT_ID=... node server.mjs
 */
import { createServer } from 'node:http';
import { VisitorTokenError, visitorVerifier } from 'gatecrypt/server';

// Made once: it fetches the service's public keys on first use and keeps them.
const verify = visitorVerifier({
  projectId: process.env.GATECRYPT_PROJECT_ID,
  // Only needed for a service other than Gatecrypt's own (here: the local mock, in tests).
  serviceUrl: process.env.GATECRYPT_SERVICE_URL,
});

// The site is on another origin, and sends an Authorization header: say that both are fine.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '600',
};

const server = createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();
  if (req.method !== 'GET' || new URL(req.url, 'http://x').pathname !== '/api/me') return send(404, { error: 'not_found' });

  try {
    const visitor = await verify(req);
    // From here on the request is from visitor.email, who was on the access list minutes ago at most.
    send(200, { email: visitor.email, origin: visitor.origin, expiresAt: visitor.expiresAt });
  } catch (error) {
    if (!(error instanceof VisitorTokenError)) throw error;
    // Not the visitor's fault if the keys could not be fetched: do not tell the site to sign them out.
    send(error.code === 'keys_unavailable' ? 503 : 401, { error: error.code });
  }
});

server.listen(Number(process.env.PORT ?? 8080), 'localhost', () => {
  console.log(`API listening on http://localhost:${server.address().port}`);
});
