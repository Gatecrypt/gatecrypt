# Contributing

## Getting started

Node 22.18 or newer and pnpm.

```sh
pnpm install
pnpm dev            # the demo site, encrypted, on http://localhost:4173, against a mock service
```

`pnpm dev` needs no account: `dev/mock-service.mjs` stands in for the
Gatecrypt service. It believes any address typed into its "Google" page and
prints emailed codes in the terminal.

## Checks

```sh
pnpm typecheck
pnpm test                                   # unit tests (Vitest)
pnpm exec playwright install chromium       # once
pnpm test:browser                           # the demo in a real browser (Playwright)
BROWSERS=chromium,firefox,webkit pnpm test:browser
pnpm test:examples                          # every example API and framework (see examples/README.md)
pnpm check:package                          # the tarball, as npm would ship it
```

All of them run in CI on every pull request.

## Layout

```
packages/gatecrypt      the npm package
  src/loader.ts           the sign-in page's script: inlined into every protected site
  src/sw.ts, sw-core.ts   the service worker that decrypts the site
  src/protect.ts          what the Vite plugin (vite.ts) and the CLI (cli.ts) both call
  src/encrypt-site.ts     turns a folder into ciphertext
  src/format.ts           the file format, shared by build, loader and service worker
  src/token.ts            how the site gets the visitor's token (client.ts and the service worker)
  src/server.ts           `gatecrypt/server`: checks a token, in the site's own API
examples/demo           a Vite + React app protected by the package; used by the browser tests
examples/apis           APIs that check visitor tokens: Node, Express + jose, Python
examples/frameworks     a site and its API in Next.js, React Router, Astro, SvelteKit and Nuxt
examples/tests          Playwright tests of all the examples
e2e                     Playwright tests of the package, with the demo
dev                     mock service, a visitor without a browser, static server, `pnpm dev`
PROTOCOL.md             the file format and the calls to the service
```

## Things to keep true

- **The loader and the service worker have no dependencies and stay small.**
  They are the only plaintext a protected site ships, and they are what a
  reviewer has to trust.
- **The loader treats what the service sends as text,** or as an image address
  on the service's own origin. Never as markup.
- **`gatecrypt/server` imports nothing,** not even from Node: it runs in
  Workers, Deno and Bun as it is.
- **A token goes only where the build said.** The service worker adds it to
  calls to the `api` addresses in the encrypted index and to no others, and
  never over plain HTTP outside localhost.
- **Fail closed.** If a build cannot be protected, its output folder is
  emptied. A change that can leave plaintext behind after an error is a bug.
- **Deployed sites keep the loader they were built with.** A change to how the
  loader talks to the service has to keep working with the service as it is;
  see the top of `PROTOCOL.md`.
- Imports between source files carry the `.js` extension, so the published
  type declarations resolve for every consumer. `pnpm check:package` proves it.

## Releasing

Maintainers: set the version in `packages/gatecrypt/package.json`, add a
section to `packages/gatecrypt/CHANGELOG.md`, and push a tag `v<version>`.
The release workflow runs every check and publishes to npm with provenance.
