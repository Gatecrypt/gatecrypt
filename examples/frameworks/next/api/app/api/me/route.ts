import { type VerifiedVisitor, VisitorTokenError, visitorVerifier } from 'gatecrypt/server';

// Made once, on the first request: it fetches the service's public keys on first use and keeps them.
// Not made when this file loads, because `next build` loads it too, and the project ID is
// the running server's to know (it is read from the environment then, not built in).
let verifier: ((request: Request) => Promise<VerifiedVisitor>) | undefined;
const verify = (request: Request) =>
  (verifier ??= visitorVerifier({
    projectId: process.env.GATECRYPT_PROJECT_ID!,
    // Only needed for a service other than Gatecrypt's own (here: the local mock, in tests).
    serviceUrl: process.env.GATECRYPT_SERVICE_URL,
  }))(request);

// The site is on another origin, and sends an Authorization header: say that both are fine.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '600',
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(request: Request) {
  try {
    const visitor = await verify(request);
    // From here on the request is from visitor.email, who was on the access list minutes ago at most.
    return Response.json({ email: visitor.email, origin: visitor.origin, expiresAt: visitor.expiresAt }, { headers: CORS });
  } catch (error) {
    if (!(error instanceof VisitorTokenError)) throw error;
    // Not the visitor's fault if the keys could not be fetched: do not tell the site to sign them out.
    return Response.json({ error: error.code }, { status: error.code === 'keys_unavailable' ? 503 : 401, headers: CORS });
  }
}
