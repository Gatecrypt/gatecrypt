# Gatecrypt

Put a static site behind a sign-in, on any host that only serves files.

The site's build is encrypted. What you deploy is ciphertext and a small
sign-in page. Visitors prove their email address (Google, or a code sent to
them); if they are on the project's access list, the site is decrypted in
their browser. Access lists and keys are held by the Gatecrypt service at
[gatecrypt.dev](https://gatecrypt.dev).

This repository is the open half: everything that runs in your build and on
your site.

| | |
| --- | --- |
| [`packages/gatecrypt`](packages/gatecrypt) | The npm package: Vite plugin, CLI, sign-in page and service worker. **[Start with its README](packages/gatecrypt/README.md)** |
| [`examples`](examples) | A protected Vite + React app; APIs that know who the visitor is, in Node and Python; and a site with its API in Next.js, React Router (Remix), Astro, SvelteKit and Nuxt |
| [`PROTOCOL.md`](PROTOCOL.md) | The file format, and every call the package makes to the service |
| [`SECURITY.md`](SECURITY.md) | How to report a vulnerability |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Running it locally, the tests, releasing |

```sh
npm install -D gatecrypt
```

```ts
// vite.config.ts
import gatecrypt from 'gatecrypt/vite';

export default defineConfig({ plugins: [gatecrypt({ projectId: 'YOUR_PROJECT_ID' })] });
```

or, for anything that is not a plain Vite app:

```sh
npx gatecrypt encrypt dist --project YOUR_PROJECT_ID
```

If the site has an API of its own, name it (`api: 'https://api.example.com'`)
and the site's requests to it carry a signed token that says who the visitor
is:

```ts
import { visitorVerifier } from 'gatecrypt/server';

const verify = visitorVerifier({ projectId: 'YOUR_PROJECT_ID' });
const { email } = await verify(request);
```

The service itself is not in this repository. The package talks to it only
through the calls in `PROTOCOL.md`, and `dev/mock-service.mjs` is a small
stand-in for it, so everything here builds, runs and is tested on its own.

MIT licensed.
