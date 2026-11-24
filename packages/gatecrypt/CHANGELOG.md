# Changelog

All notable changes to the `gatecrypt` package. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). A change to the loader or service
worker reaches a site only when that site is rebuilt.

## 0.2.0

### Added

- Visitors stay signed in after a deploy. When a browser holds the key of an
  earlier build, the sign-in page asks the service for the new build's key with
  the visitor's earlier sign-in, and they go straight in. The service checks the
  access list and the plan as it would for a sign-in. It lasts 30 days from the
  visitor's last real sign-in; change it or turn it off on the project's
  **Access** tab ("Stay signed in after a deploy"). Sites get this when they are
  rebuilt with this version.
- Speaks `POST /v1/visitor/renew` of the service interface (see `PROTOCOL.md`).

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
