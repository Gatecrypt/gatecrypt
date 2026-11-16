import { VisitorTokenError, visitorVerifier } from 'gatecrypt/server';

// Made once: it fetches the service's public keys on first use and keeps them.
const verify = visitorVerifier({
  projectId: process.env.GATECRYPT_PROJECT_ID!,
  // Only needed for a service other than Gatecrypt's own (here: the local mock, in tests).
  serviceUrl: process.env.GATECRYPT_SERVICE_URL,
});

export default defineEventHandler(async (event) => {
  try {
    // The token is in the request's Authorization header.
    const visitor = await verify(event);
    // From here on the request is from visitor.email, who was on the access list minutes ago at most.
    return { email: visitor.email, origin: visitor.origin, expiresAt: visitor.expiresAt };
  } catch (error) {
    if (!(error instanceof VisitorTokenError)) throw error;
    // Not the visitor's fault if the keys could not be fetched: do not tell the site to sign them out.
    setResponseStatus(event, error.code === 'keys_unavailable' ? 503 : 401);
    return { error: error.code };
  }
});
