import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
  // Where this site's API is (../api). Read when the site is built, and part of the pages from
  // then on, which is fine: the pages are encrypted.
  EXAMPLE_API_URL: {
    public: true,
    static: true,
    schema: (value) => value || 'http://localhost:5174',
  },
});
