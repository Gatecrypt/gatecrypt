# Gatecrypt protocol, version 1

What the `gatecrypt` package writes to a site, and what it says to the
Gatecrypt service. Everything here is public: the package is open, and so is
everything a browser can see.

The service's address is called `SERVICE` below (`https://api.gatecrypt.dev`).
Every call starts with `/v1`. Sites keep the loader they were built with until
they are rebuilt, so version 1 only ever grows: fields may be added to
answers, and callers ignore fields they do not know. A change that would break
a deployed site gets a new prefix.

## File format

After the package has run, the output folder holds:

```
index.html            the sign-in page ("loader"), plaintext
404.html              a copy of it, for deep links on hosts that serve 404.html (absolute base only)
gatecrypt-sw.js       the service worker, plaintext, identical for every site
gatecrypt.json        the public manifest
gatecrypt/<hex>.bin   one encrypted blob per original file, plus the encrypted index
(passthrough files)   left as they were
```

**Manifest** (`gatecrypt.json`):

```json
{ "v": 1, "projectId": "…", "keyId": "…", "service": "https://api.gatecrypt.dev", "index": "gatecrypt/<hex>.bin" }
```

**Blob:** `"GCE1"` (4 bytes) ‖ IV (12 random bytes, unique per blob) ‖
AES-256-GCM ciphertext and tag. One random 256-bit key per build. The
additional authenticated data ties each blob to its build and its path, so a
host cannot serve one file's ciphertext in place of another's:

- file: `gatecrypt/v1/file\n<keyId>\n<path>`
- index: `gatecrypt/v1/index\n<keyId>`

**Index**, once decrypted, is JSON:

```json
{ "v": 1,
  "files": { "assets/app-1a2b.js": { "b": "<hex>.bin", "t": "text/javascript; charset=utf-8" } },
  "fallback": "index.html",
  "passthrough": ["CNAME"] }
```

`files` maps each original path to its blob and the content type to answer
with. `fallback` is the file served for navigations that match nothing, or
null. An optional `api` lists where the site's own API is (addresses such as
`https://api.example.com`, or paths on the site's origin such as `/api`): the
service worker adds the visitor's token to calls that go there. Blob names are random, so file names are not visible on the host; the
number of files and their approximate sizes are.

## At build time

Both calls carry `Authorization: Bearer <deploy token>` and
`User-Agent: gatecrypt/<package version>`. A token belongs to one project.

### `POST SERVICE/v1/projects/:projectId/keys`

Registers a build's key. Body:

```json
{ "keyId": "<16 to 64 base64url characters>", "key": "<base64url of 32 bytes>", "version": "<package version>" }
```

| Answer | |
| --- | --- |
| `201 { "ok": true, "keyId", "name", "origins": ["https://…"] }` | Stored. `name` is the project's name, `origins` the site addresses that may sign in |
| `200` with the same body | The same key under the same `keyId` was already stored (a retry) |
| `409 { "error": "key_id_conflict" }` | A different key is stored under that `keyId` |
| `401 { "error": "invalid_token" }` | No token, a revoked one, or one for another project |
| `400 { "error": "invalid_body" \| "invalid_key_id" \| "invalid_key" }` | |

There is no call that returns a key to a deploy token.

### `GET SERVICE/v1/projects/:projectId/check`

Whether the token works. Changes nothing.
`200 { "ok": true, "name", "origins" }`, or `401` as above.

## In the visitor's browser

### `GET SERVICE/v1/projects/:projectId/sign-in`

What the sign-in page should offer and say. Public, any origin.

```json
{ "methods": ["google", "email"], "name": "Team handbook", "heading": null, "message": null, "logo": null }
```

`heading` and `message` replace the page's own when set. `logo` is the address
of an image on `SERVICE`, or null. `404` if there is no such project. The
loader applies all of it as text and as an image address, never as markup.

### The browser's signing key

Before it offers sign-in, the loader makes an ECDSA P-256 key pair whose
private half cannot be exported. Every sign-in request carries the public half
as `pub`: the 65-byte uncompressed point, base64url. A successful sign-in is
answered with a `grant`, an opaque string tied to that key, which the browser
later shows to be given tokens (see "Tokens") and the keys of newer builds
(see "After a new deploy"). The service leaves `grant` out when the project's
visitors get neither; the sign-in is complete without it.

### `GET SERVICE/v1/visitor/google?project=&keyId=&origin=&req=&pub=`

Opened by the loader in a pop-up. `origin` is the site's own origin and must
be one of the project's site addresses; `req` is a random value the loader
makes up. The service identifies the visitor with Google, decides, and its
last page posts one message to the window that opened it, addressed to
`origin` (so no other origin can receive it):

```js
{ type: 'gatecrypt:result', req, ok: true, keyId, key, email, grant }   // key: base64url of 32 bytes
{ type: 'gatecrypt:result', req, ok: false, error }
```

The loader accepts a message only from `SERVICE`'s origin, from the pop-up it
opened, with its own `req`.

### `POST SERVICE/v1/visitor/email`

Called by the loader from the site's page, without cookies. Body
`{ "project", "keyId", "email", "pub" }`. The request's `Origin` header must be one
of the project's site addresses. Answers `200 { "ok": true, "flow": "…" }`
whether or not the address may open the site: if it may, a 6-digit code is
emailed to it; if not, nothing is sent.

### `POST SERVICE/v1/visitor/email/verify`

Body `{ "flow", "code" }`, from the same origin that asked.
`200 { "ok": true, "keyId", "key", "email", "grant" }`, or `{ "ok": false, "error" }`.

### `POST SERVICE/v1/visitor/token`

Called from the site's page or its service worker, without cookies, from the
origin that signed in. Body `{ "grant", "challenge", "proof" }`, where `proof`
is the base64url ECDSA P-256 / SHA-256 signature (64 bytes, r then s), by the
browser's signing key, of the UTF-8 text

```
gatecrypt/v1/token\n<grant>\n<challenge>
```

| Answer | |
| --- | --- |
| `200 { "ok": true, "token", "expiresIn", "challenge" }` | A token, the seconds it lasts, and the challenge to sign next time |
| `200 { "ok": true, "challenge" }` | No token: `challenge` was missing or too old. Sign this one and ask again |
| `401 { "ok": false, "error": "expired" }` | The grant is not valid (any more), or not for this origin: sign in again |
| `403 { "ok": false, "error": "not_authorized" \| "origin_not_registered" }` | The address is off the access list, or the site is no longer the project's |
| `403 { "ok": false, "error": "tokens_unavailable" }` | The project's visitors do not get tokens (any more). The sign-in stands; there is just no token |
| `400 { "ok": false, "error": "invalid_proof" \| "invalid_request" }` | |

A first request sends only `grant` and is answered with a challenge. The
access list is read at every request, so a token is never given to someone
who has been removed.

### `POST SERVICE/v1/visitor/renew`

After a new deploy, the key the browser holds is for the build before. This
asks for the key of the build in the manifest without signing in again.
Called from the site's page, without cookies, from the origin that signed in.
Body `{ "project", "keyId", "grant", "challenge", "proof" }`, where `keyId` is
the build asked for and `proof` is the signature, as for a token, of

```
gatecrypt/v1/renew\n<grant>\n<challenge>\n<keyId>
```

so a proof is good for one build, and is never a token's proof. A challenge
from a token answer may be used; a first request without one is answered
with one.

| Answer | |
| --- | --- |
| `200 { "ok": true, "keyId", "key", "email" }` | The build's key, as a sign-in answers it. The browser keeps the grant it has |
| `200 { "ok": true, "challenge" }` | Sign this one and ask again |
| `401 { "ok": false, "error": "expired" }` | The grant is not valid, not for this origin or project, or the project does not (any more) let this sign-in carry over: sign in again |
| `403 { "ok": false, "error": "not_authorized" \| "origin_not_registered" \| "visitor_limit" }` | As for a sign-in |
| `400 { "ok": false, "error": "key_unavailable" \| "invalid_proof" \| "invalid_request" }` | |

A sign-in carries over for as many days after it was made as the project
allows (30 unless its owner changes it, and never past its grant), and only
while the way it was made is still offered. Everything else is decided as for
a sign-in, at the time of the request.

### Errors

`error` in a message or an answer is one of:

| | |
| --- | --- |
| `not_authorized` | The address is not on the project's access list |
| `email_unverified` | The Google account's address is not verified |
| `origin_not_registered` | The site's origin is not one of the project's site addresses |
| `key_unavailable` | The service no longer holds this build's key: the site needs a new build |
| `visitor_limit` | The project's team has had all the visitors its plan allows this month, and this would be a new one |
| `method_unavailable` | The project has switched this way of signing in off |
| `invalid_request`, `invalid_email` | |
| `too_many_codes` | Too many codes requested for this address |
| `wrong_code`, `too_many_tries`, `expired` | The code did not match; too many wrong tries; the code is used up or too old |
| `cancelled`, `provider_error` | Google sign-in was abandoned or failed |
| `invalid_proof` | A token request was not signed by the browser the grant was given to |

The loader treats any other value as "sign-in failed".

## What the loader does with a key

It checks that `keyId` is the one in its manifest, imports the key as a
non-extractable AES-GCM `CryptoKey`, proves it decrypts the index, and stores
it in IndexedDB (database `gatecrypt:<scope path>`, store `keys`, entry
`current`: `{ keyId, projectId, key, email, service, grant, signKey }`, the
last being the private half of the browser's signing key). It then registers
the service worker and reloads. The service worker answers same-origin `GET`s under its
scope by fetching the blob, decrypting it and responding with the stored
content type. On every navigation it re-reads the manifest and the stored key;
when they no longer match (a new build, or signed out) it serves the loader.

## After a new deploy

The loader finds a stored key whose `keyId` is not the manifest's. If the
entry holds a grant and signing key from the same `service` and `projectId`,
it asks `/v1/visitor/renew` for the new build's key. On success it checks and
stores that key as above, beside the same `email`, `grant` and `signKey`, and
the visitor does not see the sign-in screen. When the service refuses, the
entry is deleted and the sign-in screen is shown (with the reason, for
`not_authorized`, `origin_not_registered` and `visitor_limit`). On
`key_unavailable` the entry is kept and the page says the site needs a new
build. When there is no clear answer (offline, or the service is down), the
entry is kept and the sign-in screen is shown.

## Tokens

A token says who the visitor is, to the site's own API. It is a JWT, signed
by the service with ES256, that lasts a few minutes:

```json
{ "alg": "ES256", "typ": "JWT", "kid": "…" }
{ "iss": "https://api.gatecrypt.dev", "aud": "<project id>", "sub": "ada@example.com",
  "email": "ada@example.com", "email_verified": true, "origin": "https://docs.example.com",
  "auth_time": 1767225600, "iat": 1767229200, "exp": 1767229800 }
```

`iss` is `SERVICE`. `aud` is the project. `sub` and `email` are the address
the visitor proved, lower-cased. `origin` is the site they signed in on, and
`auth_time` when.

The page gets one with `getVisitorToken()` from `gatecrypt/client`, or the
service worker adds `Authorization: Bearer <token>` to calls to the addresses
in the index's `api`. Either way it is fetched with the call above when the
copy in IndexedDB (entry `token` of the same store) is about to run out. When
the service refuses, the stored key is deleted and the page reloads to the
sign-in screen; except on `tokens_unavailable`, after which the site simply
has no token to send.

### `GET SERVICE/v1/jwks.json`

The public keys tokens are signed with, as a JWK Set. Public, any origin.

```json
{ "keys": [{ "kty": "EC", "crv": "P-256", "x": "…", "y": "…", "kid": "…", "alg": "ES256", "use": "sig" }] }
```

An API checks a token's signature against the key named by its `kid`, and that
`iss` is the service, `aud` its own project and `exp` in the future.
`visitorVerifier` in `gatecrypt/server` does exactly that; so does any JWT
library. The same set is at `SERVICE/.well-known/jwks.json`, and
`SERVICE/.well-known/openid-configuration` names it, for libraries that look
there.

`dev/mock-service.mjs` in this repository implements the service's side of
all of the above in about three hundred lines, for tests and local work, and
`dev/visitor.mjs` the browser's side of signing in and asking for a token.
