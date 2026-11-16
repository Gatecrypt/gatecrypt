import { defineEnvVars } from '@sveltejs/kit/env';

// Both are read when the server starts, so one build can be given to any project. SvelteKit also
// checks them when it builds (it runs the app once to look at its routes): GATECRYPT_PROJECT_ID
// has to be set then too, to any value.
export const variables = defineEnvVars({
  // Project ID from the Gatecrypt dashboard.
  GATECRYPT_PROJECT_ID: {},
  // Only needed for a service other than Gatecrypt's own (here: the local mock, in tests).
  GATECRYPT_SERVICE_URL: { schema: (value) => value || undefined },
});
