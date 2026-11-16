import { GATECRYPT_PROJECT_ID, GATECRYPT_SERVICE_URL } from '$app/env/private';
import { json, type RequestHandler } from '@sveltejs/kit';
import { VisitorTokenError, visitorVerifier } from 'gatecrypt/server';

// Made once: it fetches the service's public keys on first use and keeps them.
const verify = visitorVerifier({ projectId: GATECRYPT_PROJECT_ID, serviceUrl: GATECRYPT_SERVICE_URL });

// The site is on another origin, and sends an Authorization header: say that both are fine.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '600',
};

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: CORS });

export const GET: RequestHandler = async ({ request }) => {
  try {
    const visitor = await verify(request);
    // From here on the request is from visitor.email, who was on the access list minutes ago at most.
    return json({ email: visitor.email, origin: visitor.origin, expiresAt: visitor.expiresAt }, { headers: CORS });
  } catch (error) {
    if (!(error instanceof VisitorTokenError)) throw error;
    // Not the visitor's fault if the keys could not be fetched: do not tell the site to sign them out.
    return json({ error: error.code }, { status: error.code === 'keys_unavailable' ? 503 : 401, headers: CORS });
  }
};
