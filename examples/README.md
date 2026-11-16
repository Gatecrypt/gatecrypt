# Examples

Everything here is run by tests (`pnpm test:examples`, see
[`tests`](tests)), against `dev/mock-service.mjs`, so it works as written.

## A protected site

| | |
| --- | --- |
| [`demo`](demo) | A Vite + React app with routing and a lazy route, protected with the Vite plugin. Its "Account" page calls the API in [`apis/node`](apis/node). `pnpm dev` runs both |

## An API that knows who the visitor is

A protected site's requests to its own API carry the visitor's token (the
`api` build option). Each of these checks it and answers `GET /api/me` with
the visitor's address. See "Your API" in the
[package README](../packages/gatecrypt/README.md#your-api).

| | |
| --- | --- |
| [`apis/node`](apis/node) | Plain Node, with `gatecrypt/server` |
| [`apis/jose`](apis/jose) | Express and [jose](https://github.com/panva/jose), a general JWT library: nothing from Gatecrypt installed |
| [`apis/python`](apis/python) | Python, with PyJWT and the standard library (`uv run server.py`) |

## Full-stack frameworks

A protected site is files, so a framework's pages are built as static files
and encrypted with the CLI, and its server routes live in an API that checks
the token. Each folder has both halves, in the same framework:

| | `site`: built with, then encrypted | `api`: where the token is checked |
| --- | --- | --- |
| [`frameworks/next`](frameworks/next) | `output: 'export'`, `gatecrypt encrypt out` | A route handler, `app/api/me/route.ts` |
| [`frameworks/react-router`](frameworks/react-router) (Remix) | `ssr: false`, `gatecrypt encrypt build/client` | A resource route, `app/routes/api.me.ts` |
| [`frameworks/astro`](frameworks/astro) | `astro build`, `gatecrypt encrypt dist` | An endpoint, `src/pages/api/me.ts` |
| [`frameworks/sveltekit`](frameworks/sveltekit) | adapter-static, `gatecrypt encrypt build` | An endpoint, `src/routes/api/me/+server.ts` |
| [`frameworks/nuxt`](frameworks/nuxt) | `nuxt generate`, `gatecrypt encrypt .output/public` | A server route, `server/api/me.get.ts` |

Every `site` reads four variables when it is built: `GATECRYPT_PROJECT_ID`,
`GATECRYPT_DEPLOY_TOKEN`, `GATECRYPT_API` (the address of its API, which
Gatecrypt sends the token to) and `EXAMPLE_API_URL` (the same address, for the
site's own code to call). Every `api` reads `GATECRYPT_PROJECT_ID` when it
runs. `GATECRYPT_SERVICE_URL` points either at a service other than
Gatecrypt's own, which is how the tests use the mock.

Two things the frameworks taught us:

- Some of them load your route files while building (Next.js) or check your
  environment then (SvelteKit). Make the verifier on the first request, or
  give the build the project ID too.
- Sites made of separate pages (Next.js export, Astro, SvelteKit, Nuxt) are
  encrypted with `--no-spa-fallback`; a single-page app (React Router's SPA
  mode) is not.

## What the tests check

- **Every API**, eight of them: it names a signed-in visitor; it refuses no
  token, a spoiled one, one for another project or from another service, an
  expired one, and one signed with any other key or with no real signature.
- **Every framework's site**, in a browser: what is deployed is ciphertext;
  after sign-in its pages show and its API names the visitor; a first visit to
  an inner page works; a visitor who has not signed in is nobody to the API.

```sh
pnpm test:examples                       # all of them; the first run builds five frameworks
EXAMPLES=next,python pnpm test:examples  # some of them
```

The Astro and Nuxt examples need Node 22.23 or newer, and the Python one
needs [uv](https://docs.astral.sh/uv/) (without it, it is skipped, except in CI).
