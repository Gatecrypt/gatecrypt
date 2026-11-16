/**
 * The same API with Express and jose, a general JWT library: nothing from
 * Gatecrypt is installed. A visitor's token is an ordinary ES256 JWT, so
 * whatever your stack already uses for JWTs can check it. What to check:
 *
 *   signature   against the keys at <service>/v1/jwks.json
 *   iss         the service
 *   aud         your project ID
 *   exp         not passed (the library does this)
 *
 *   GATECRYPT_PROJECT_ID=... node server.mjs
 */
import express from 'express';
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';

const SERVICE = process.env.GATECRYPT_SERVICE_URL ?? 'https://api.gatecrypt.dev';
const PROJECT_ID = process.env.GATECRYPT_PROJECT_ID;

// Fetched on first use, kept, and fetched again when a token names a key that is new.
const keys = createRemoteJWKSet(new URL(`${SERVICE}/v1/jwks.json`));

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
    'cache-control': 'no-store',
  });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/** Puts the visitor on the request, or answers 401. */
async function visitor(req, res, next) {
  const match = /^Bearer +(\S+)$/i.exec(req.get('authorization') ?? '');
  if (!match) return res.status(401).json({ error: 'missing' });
  try {
    const { payload } = await jwtVerify(match[1], keys, {
      issuer: SERVICE,
      audience: PROJECT_ID,
      // Never let the token choose how it is checked.
      algorithms: ['ES256'],
      requiredClaims: ['email', 'origin', 'exp', 'iat'],
    });
    // A token for several projects at once is not one the service makes.
    if (typeof payload.aud !== 'string') return res.status(401).json({ error: 'wrong_audience' });
    req.visitor = payload;
    next();
  } catch (error) {
    // The keys could not be fetched: our problem, not the visitor's.
    if (error instanceof errors.JWKSTimeout || !(error instanceof errors.JOSEError)) return res.status(503).json({ error: 'keys_unavailable' });
    res.status(401).json({ error: error instanceof errors.JWTExpired ? 'expired' : 'invalid' });
  }
}

app.get('/api/me', visitor, (req, res) => {
  res.json({ email: req.visitor.email, origin: req.visitor.origin, expiresAt: req.visitor.exp });
});

app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

const server = app.listen(Number(process.env.PORT ?? 8080), 'localhost', () => {
  console.log(`API listening on http://localhost:${server.address().port}`);
});
