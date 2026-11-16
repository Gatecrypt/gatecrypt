# gatecrypt

Put any static site behind a sign-in. No server, no proxy: it works on GitHub
Pages, S3, and any other host that only serves files.

Your build output is encrypted. The only plaintext you deploy is a small
sign-in page. Visitors sign in on that page, with Google (one click) or with a
code sent to their email; if they are on your project's access list (by email
or by company domain) the site is decrypted in their browser. Everyone else
sees nothing.

You manage access lists, teams and a sign-in log in the
[Gatecrypt dashboard](https://gatecrypt.dev).

## Set up

1. Create a project in the [dashboard](https://gatecrypt.dev). It gives you a
   **project ID** and a **deploy token**, and asks for the address your site is
   served from.
2. Install the package (Node 22 or newer):

   ```sh
   npm install -D gatecrypt
   ```

3. Add it to your build.

   **Vite**

   ```ts
   // vite.config.ts
   import gatecrypt from 'gatecrypt/vite';
   import { defineConfig } from 'vite';

   export default defineConfig({
     plugins: [gatecrypt({ projectId: 'YOUR_PROJECT_ID' })],
   });
   ```

   **Anything else** (Astro, SvelteKit, Next.js static export, VitePress,
   Docusaurus, Hugo, plain HTML): run the CLI on the folder you deploy, after
   your build.

   ```sh
   npx gatecrypt encrypt dist --project YOUR_PROJECT_ID
   ```

4. Give your build the deploy token as the `GATECRYPT_DEPLOY_TOKEN` environment
   variable (a secret in CI), then build and deploy as usual.

   ```yaml
   # GitHub Actions
   - run: npm ci && npm run build
     env:
       GATECRYPT_DEPLOY_TOKEN: ${{ secrets.GATECRYPT_DEPLOY_TOKEN }}
   ```

To check the project ID and token without building anything:

```sh
npx gatecrypt check --project YOUR_PROJECT_ID
```

`vite dev` is unaffected. Each build makes a new key, registers it, and
replaces the contents of the output folder with:

```
index.html, 404.html    the sign-in page
gatecrypt-sw.js         the service worker that decrypts the site
gatecrypt.json          project ID, key ID, service address
gatecrypt/*.bin         your files, encrypted
```

**If anything goes wrong, the build fails and the folder is emptied**: a
missing token, a mistyped option, the service refusing the key. A build that
was meant to be protected is never left behind in plaintext, where a later
deploy step could pick it up.

## Options

Vite plugin options, with the matching CLI flag and environment variable:

| Option | CLI | Default | |
| --- | --- | --- | --- |
| `projectId` | `--project` | `GATECRYPT_PROJECT_ID` | From the dashboard |
| `deployToken` | | `GATECRYPT_DEPLOY_TOKEN` | Keep it out of source control |
| `passthrough` | `--passthrough` | `CNAME`, `.nojekyll` | Files left unencrypted: exact paths, `dir/` prefixes, or (plugin only) regular expressions. For `robots.txt`, favicons, `_headers` and the like |
| `spaFallback` | `--no-spa-fallback` | on | Serve `index.html` for paths that match no file, so client-side routes survive a reload |
| `title` | `--title` | `Protected page` | Heading of the sign-in page. Public. The dashboard's setting, if any, replaces it |
| `lang` | `--lang` | `en` | Language of the sign-in page |
| `text` | `--text file.json` | English | Replacements for the sign-in page's sentences. See [Translating](#translating-the-sign-in-page) |
| `enabled` | | `true` | Plugin only. `false` builds the plain site. See [Builds without the token](#builds-without-the-token) |
| `api` | `--api` | `GATECRYPT_API` | Your own API, if the site has one: its requests there carry the visitor's token. See [Your API](#your-api) |
| `serviceUrl` | `--service` | `GATECRYPT_SERVICE_URL`, then `https://api.gatecrypt.dev` | Only for a service other than Gatecrypt's own |
| | `--base` | `/` | Path the site is served under, e.g. `/my-repo/`. The plugin reads Vite's `base` |

The Vite plugin also reads the `GATECRYPT_` variables from Vite's env
files, so a `.env.local` holding `GATECRYPT_DEPLOY_TOKEN=gcd_...` works for
local builds. Keep that file out of git.

Use one project per environment (production, staging). The project ID is not
a secret; switching it by environment variable is the simplest way:

```ts
gatecrypt() // GATECRYPT_PROJECT_ID decides
```

## Frameworks

The Vite plugin is for plain Vite apps (React, Vue, Svelte, Solid, ...). For a
framework that drives Vite itself, the plugin stops the build and says so,
because such frameworks write the folder you deploy after Vite has finished.
Use the CLI on the finished folder instead; it works with anything that
produces static files:

| | Build | Then |
| --- | --- | --- |
| Astro | `astro build` | `gatecrypt encrypt dist` |
| SvelteKit (adapter-static) | `vite build` | `gatecrypt encrypt build` |
| Next.js (`output: 'export'`) | `next build` | `gatecrypt encrypt out` |
| React Router or Remix (`ssr: false`) | `react-router build` | `gatecrypt encrypt build/client` |
| Nuxt (`nuxt generate`) | `nuxt generate` | `gatecrypt encrypt .output/public` |
| VitePress | `vitepress build docs` | `gatecrypt encrypt docs/.vitepress/dist` |
| Docusaurus | `docusaurus build` | `gatecrypt encrypt build` |
| Hugo, Jekyll, Eleventy | as usual | `gatecrypt encrypt public` (or `_site`) |

```json
{ "scripts": { "build": "astro build && gatecrypt encrypt dist" } }
```

Sites made of separate pages rather than one app usually want
`--no-spa-fallback`, so that an unknown address gets your host's 404 page and
not the home page.

Server routes of these frameworks (route handlers, loaders, endpoints) cannot
be part of a protected site, which is files only. Keep them as an API and let
it know the visitor from their token: see [Your API](#your-api). The
[framework examples](https://github.com/Gatecrypt/gatecrypt/tree/main/examples/frameworks)
do exactly that for Next.js, React Router, Astro, SvelteKit and Nuxt.

## Trying it locally

A protected build runs on `localhost` like anywhere else: add
`http://localhost:4173` (or whichever port you use) to the project's site
addresses in the dashboard, build, and serve the output folder, for example
with `vite preview`. Sign-in needs HTTPS everywhere except `localhost`.

## Builds without the token

Pull requests from forks, Dependabot and new contributors do not have your
deploy token, and a build that cannot register its key fails. For builds that
are only compiled and tested, never deployed, turn the plugin off:

```ts
gatecrypt({ enabled: process.env.GATECRYPT !== 'off' })
```

A disabled build is the plain, readable site. Never deploy one.

## The sign-in page

Choose which ways of signing in to offer (Google, emailed code, or both) under
the project's **Access** tab, and set the heading, message and a logo under
**Settings**. By default the page says "Protected page" and "Sign in to access
<your project's name>". The sign-in page picks the changes up the next time it
is opened; you do not need to rebuild your site. The page carries a small
"Powered by Gatecrypt" link in its corner.

### Translating the sign-in page

`lang` sets the page's language and `text` replaces any of its sentences. What
you do not replace stays English.

```ts
gatecrypt({
  lang: 'de',
  text: {
    title: 'Nur für Mitglieder',
    signInTo: 'Anmelden bei {name}',
    google: 'Weiter mit Google',
    sendCode: 'Code per E-Mail senden',
    codeSent: 'Falls {email} Zugriff hat, ist ein 6-stelliger Code unterwegs.',
  },
})
```

The full list of sentences is `DEFAULT_TEXT`, exported from `gatecrypt` (and
typed, so your editor completes the names). The CLI takes the same object as a
JSON file: `--lang de --text de.json`. The pop-up that Google sign-in opens
and the email carrying the code come from the service and are in English.

## In your app

```ts
import { getVisitor, getVisitorToken, signOut } from 'gatecrypt/client';

const visitor = await getVisitor(); // { email: 'alice@example.com' }, or null
const token = await getVisitorToken(); // for your own API: see below
button.onclick = () => signOut(); // forgets the key in this browser and shows the sign-in page
```

`getVisitor()` is for showing who is signed in. It reads this browser's own
storage, which its user can edit, so do not base decisions on it. Under
`vite dev`, where nobody signs in, it answers `null`. What your server can rely
on is the token.

## Your API

A protected site often has an API of its own. Gatecrypt tells that API who the
visitor is: the site's requests carry a short-lived token, signed by the
Gatecrypt service, and your API checks the signature. No session store, no
shared secret, no request to Gatecrypt per call. Visitor tokens are part of
the paid plans.

**1. Say where your API is,** when you build:

```ts
gatecrypt({ projectId: 'YOUR_PROJECT_ID', api: 'https://api.example.com' })
```

```sh
npx gatecrypt encrypt dist --project YOUR_PROJECT_ID --api https://api.example.com
```

`api` is an address (a path may follow: `https://example.com/api`), a path on
the site's own address (`/api`), or a list of them. From then on, every
`fetch` or `XMLHttpRequest` the site makes to it is sent with
`Authorization: Bearer <token>`. Your site's code does not change. The
addresses are stored inside the encrypted build, not in public.

If your API is on another address than the site, it must allow the header:
answer the browser's preflight (`OPTIONS`) with
`Access-Control-Allow-Headers: authorization`.

**2. Check the token,** in your API:

```ts
import { VisitorTokenError, visitorVerifier } from 'gatecrypt/server';

// Once, when the server starts.
const verify = visitorVerifier({ projectId: 'YOUR_PROJECT_ID' });

// For each request: a Fetch Request, or Node's IncomingMessage, or the token itself.
try {
  const visitor = await verify(request);
  visitor.email; // 'ada@example.com': on the access list a few minutes ago at most
} catch (error) {
  if (!(error instanceof VisitorTokenError)) throw error;
  // error.code: 'missing', 'malformed', 'bad_signature', 'expired', 'wrong_audience': answer 401.
  //             'keys_unavailable' (Gatecrypt could not be reached): answer 503.
}
```

`gatecrypt/server` has no dependencies and runs wherever `fetch` and WebCrypto
do: Node, Cloudflare Workers, Deno, Bun. It fetches the service's public keys
once and keeps them.

`verify` resolves to `{ email, projectId, origin, signedInAt, issuedAt,
expiresAt, claims }`. Options besides `projectId`: `origins` (accept tokens
only from some of the project's site addresses), `clockTolerance` (seconds,
default 30), `serviceUrl`.

**Not JavaScript?** The token is an ordinary JWT, signed with ES256. Check it
with whatever JWT library you use:

| | |
| --- | --- |
| Keys (JWKS) | `https://api.gatecrypt.dev/v1/jwks.json` |
| Algorithm | `ES256`, and only that |
| Issuer (`iss`) | `https://api.gatecrypt.dev` |
| Audience (`aud`) | Your project ID |
| The visitor | `email` (also `sub`), lower-cased |
| Also | `origin` (the site address they signed in on), `auth_time` (when), `exp` |

**What a token means.** At the moment it was made, at most ten minutes ago,
the address was on the project's access list. It says nothing else: what a
visitor may do in your API is yours to decide.

- Take someone off the access list and their browser gets no new token; the
  one it holds stops working within ten minutes, and when the site next asks
  for one, the visitor is signed out of the site too.
- A sign-in earns tokens for thirty days. After that the next request for one
  sends the visitor back to the sign-in page.
- The browser proves itself to the service with a signing key that cannot be
  copied out of it, so nothing a script can read from the browser's storage
  is enough to get tokens somewhere else.
- A token itself is a bearer token: whoever holds one can use it until it
  expires. Use HTTPS (the build refuses an `api` that is not, outside
  localhost), and do not log it.

**By hand.** For an API that was not named in the build, or a request made
some other way (a WebSocket, a form), ask for the token yourself:

```ts
const token = await getVisitorToken(); // null under `vite dev`, or when the plan has no tokens
fetch(url, { headers: { Authorization: `Bearer ${token}` } });
```

Call it for every request instead of keeping the answer: it returns the copy
it has until that is about to expire. A header your code sets is never
replaced by the service worker.

**While developing.** Under `vite dev` nobody is signed in and requests carry
no token, so let your API skip the check locally, or run the built site:
`pnpm dev` in the [repository](https://github.com/Gatecrypt/gatecrypt) starts
a mock of the service that signs real tokens.

**Examples,** each with tests that run them: an API in
[plain Node](https://github.com/Gatecrypt/gatecrypt/tree/main/examples/apis/node),
with [Express and jose](https://github.com/Gatecrypt/gatecrypt/tree/main/examples/apis/jose)
and in [Python](https://github.com/Gatecrypt/gatecrypt/tree/main/examples/apis/python);
and a site with its API in
[Next.js, React Router (Remix), Astro, SvelteKit and Nuxt](https://github.com/Gatecrypt/gatecrypt/tree/main/examples/frameworks).

## Hosting notes

- **Deep links.** `404.html` is a copy of the sign-in page, so on hosts that
  serve it for unknown paths (GitHub Pages, Cloudflare Pages, S3 with an error
  document) a first visit to `/some/route` signs in and lands on that route.
- **One origin.** The whole site must be served from one origin; assets cannot
  live on a separate CDN host.
- **Files your host reads.** `_headers`, `_redirects`, `robots.txt`,
  `.well-known/` and the like are encrypted with everything else, so the host
  no longer sees them. The build warns when it finds one; list it under
  `passthrough` to keep it readable (and public).
- **Do not send `Cross-Origin-Opener-Policy: same-origin`** from your host. It
  disconnects the Google sign-in pop-up from the page that opened it.
- **If your host sends a Content-Security-Policy,** allow the Gatecrypt service
  in `connect-src` and `img-src` (`https://api.gatecrypt.dev`), and the inline
  script and style of the sign-in page.
- **GitHub Pages custom domains:** `CNAME` and `.nojekyll` are left in
  plaintext by default so Pages keeps working.

## When something is wrong

What a visitor sees, and what it means for you:

| The sign-in page says | Cause | Fix |
| --- | --- | --- |
| This site's address is not registered with the sign-in service | The site is served from an address the project does not list | Add the address (scheme, host and port, e.g. `https://docs.example.com`) under the project's site addresses |
| This site is not connected to a sign-in project | The project ID in the build does not exist, or the project was deleted | Check `projectId`, rebuild |
| The key for this version of the site is no longer available | The deployed build is old and its key has been dropped (see below) | Build and deploy again |
| That account is not authorized to view this site | The address is not on the access list | Add the email or its domain under **Access** |
| The sign-in service cannot be reached | Network trouble, or a Content-Security-Policy on your host blocks the service | See the hosting notes |
| Your browser blocked the sign-in window | Pop-ups are blocked | The visitor allows pop-ups, or uses the emailed code |
| Could not start the site in this browser | Another service worker controls the site, or the browser has service workers off | See "One service worker" below |
| The sign-in page appears again after every reload | Same as above | |

In the build:

| The build says | Fix |
| --- | --- |
| could not register the build key: ... answered 401 | The token is wrong, revoked, or belongs to another project. `npx gatecrypt check` tells you which project it works for |
| no deploy token | Set `GATECRYPT_DEPLOY_TOKEN` where the build runs. In GitHub Actions a secret must be passed to the step with `env:` |
| is already encrypted | The folder was encrypted by an earlier run. Run your own build first |
| this is a ... build, which the Vite plugin cannot protect | Use the CLI. See [Frameworks](#frameworks) |

**Replacing a deploy token:** create a new one in the dashboard, put it where
your build reads it, then revoke the old one. Deployed sites are not affected:
tokens are only used while building.

## What it does not do

Read this before relying on it.

- **Removing someone does not take back a key they already have.** Removal
  blocks every future sign-in. A browser that already opened the current build
  keeps access to it until you build and deploy again. To cut someone off:
  remove them, then redeploy.
- **One key per build, shared by everyone.** All allowed visitors receive the
  same key. Anyone who has it can decrypt that build's files, which are public
  on your host.
- **The sign-in page must be trusted.** Whoever can change files on your host,
  or run script on the same origin, can replace it and steal the key from the
  next visitor. Gatecrypt protects content from people who can only read your
  host, not from someone who can write to it.
- **Your backend still has to check.** Gatecrypt hides static files; it does
  not stand in front of your API. An API the site calls must check the
  visitor's token on every request (see [Your API](#your-api)), and API secrets
  do not belong in the bundle: every allowed visitor can read them.
- **Pages are not rendered on a server.** The site is files, decrypted in the
  browser. With Next.js, Remix and the like, build the site as static files
  (static export, SPA mode) and keep server code in an API.
- **A token outlives removal by up to ten minutes.** See [Your API](#your-api).
- **Access is per origin, not per path.** Other pages on the same origin (for
  example other repositories on `you.github.io`) can read the stored key. Give
  a protected site an origin of its own if you share the host.
- **One service worker.** Gatecrypt's service worker is what decrypts the
  site, and a path can only have one. If your app registers its own (a PWA
  plugin, Workbox, Firebase messaging), the two replace each other and the
  site stops loading. Turn the app's service worker off; the build warns when
  it sees one.
- **The service is the trust anchor.** It can release keys, so whoever operates
  it can decrypt any build they can download.
- **Some metadata is visible:** the number of files, their approximate sizes,
  the project ID, the project's name, and the text of the sign-in page. File names and contents
  are not.
- **A domain rule trusts whoever controls the mailbox.** `example.com` admits
  anyone who can sign in to Google as, or receive a code at, an `@example.com`
  address. If the domain is not a Google Workspace domain, that includes
  personal Google accounts created with such an address. List exact emails if
  that matters, and turn off whichever sign-in method you do not want in the
  project's settings.
- **Browser requirements:** JavaScript, service workers and IndexedDB, over
  HTTPS. Signing in with Google also needs pop-ups; the emailed code does not. There is no offline mode. Files are decrypted whole in memory,
  which suits front-end assets, not multi-gigabyte media.
- **Old builds stop opening.** A build can be opened while it is one of the
  project's newest five, or while someone has signed in to it in the last 90
  days. Builds that are never deployed (pull requests, previews) do not push a
  deployed site out. A site nobody has signed in to for 90 days, with five
  newer builds since, asks visitors to wait for a redeploy.

## How it works

Each file is encrypted with AES-256-GCM under a fresh random key per build,
with a unique nonce per file, bound to its path so files cannot be swapped.
File names are replaced with random ones. The sign-in page proves the visitor's
email address to the Gatecrypt service: with Google, in a pop-up that goes
straight to Google, or with a code emailed to them and typed into the page. The
service checks the project's access list and gives the key to the site's
registered address only. The page stores it as a non-extractable key and a
service worker decrypts requests on the fly. Only WebCrypto is used in the browser; the loader has no
dependencies.

The file format and the calls between this package and the service are written
down in [PROTOCOL.md](https://github.com/Gatecrypt/gatecrypt/blob/main/PROTOCOL.md).
Source, issues and security reports: [github.com/Gatecrypt/gatecrypt](https://github.com/Gatecrypt/gatecrypt).

## Other build tools

```ts
import { protectSite } from 'gatecrypt';

await protectSite({ dir: 'dist', projectId: 'YOUR_PROJECT_ID' });
```

`protectSite` takes the options above (plus `base`) and is what the plugin and
the CLI call.
