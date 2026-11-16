# Changelog

All notable changes to the `gatecrypt` package. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). A change to the loader or service
worker reaches a site only when that site is rebuilt.

## 0.1.0

First public release.

- Vite plugin (`gatecrypt/vite`), CLI (`gatecrypt encrypt`, `gatecrypt check`)
  and build API (`protectSite`).
- Sign-in page with Google and emailed codes; text and language can be replaced
  per build (`lang`, `text`).
- `gatecrypt/client`: `signOut()`, `getVisitor()` and `getVisitorToken()`.
- Visitor tokens, for the site's own API: the `api` option (`--api`,
  `GATECRYPT_API`) makes the service worker send the visitor's token with
  calls to it, and `gatecrypt/server` (`visitorVerifier`) checks one.
- Speaks version 1 of the service interface (`/v1`, see `PROTOCOL.md`).
