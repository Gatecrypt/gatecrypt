import { VisitorTokenError, visitorVerifier } from 'gatecrypt/server';
import type { Route } from './+types/api.me';

// Made once: it fetches the service's public keys on first use and keeps them.
const verify = visitorVerifier({
  projectId: process.env.GATECRYPT_PROJECT_ID!,
  // Only needed for a service other than Gatecrypt's own (here: the local mock, in tests).
  serviceUrl: process.env.GATECRYPT_SERVICE_URL,
});

// The site is on another origin, and sends an Authorization header: say that both are fine.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '600',
};

// A route with no component is a resource route: what the loader returns is the whole response.
// React Router gives the loader GET, HEAD and OPTIONS; anything else would go to an `action`.
export async function loader({ request }: Route.LoaderArgs) {
  // The browser asks first (a preflight) whether the Authorization header may be sent.
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
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
