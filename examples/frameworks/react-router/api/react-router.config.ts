import type { Config } from '@react-router/dev/config';

// Server-rendered, so that the loader in app/routes/api.me.ts runs for each request.
export default {
  ssr: true,
} satisfies Config;
