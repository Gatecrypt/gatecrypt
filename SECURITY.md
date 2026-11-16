# Security

Gatecrypt exists to keep private sites private, so reports of ways around it
are welcome and are handled first.

## Reporting a vulnerability

Please report privately, not in a public issue: use **Report a vulnerability**
under this repository's **Security** tab
([private vulnerability reporting](https://github.com/Gatecrypt/gatecrypt/security/advisories/new)). Include what you found, how to reproduce it, and which version of
the package or which deployed site it concerns.

You will get an answer within three working days. Fixes to the package are
released as a new version with a note in the changelog; because a site keeps
the loader it was built with, a fix reaches a site when it is rebuilt, and
the note says when a rebuild is needed.

This covers the `gatecrypt` package (this repository) and the hosted service
at `gatecrypt.dev` and `api.gatecrypt.dev`. Please do not test against other
people's projects or sites: create your own project.

## What is and is not a vulnerability

The package's README lists what Gatecrypt does not protect against, under
"What it does not do": someone who can write to your host, a key already
delivered to a browser, other pages on the same origin. Those are the design's
stated limits, not vulnerabilities. Anything that lets someone read a
protected site without being on its access list, obtain a key they were not
entitled to, or learn who is on a list, is.

## Supported versions

The latest release. Before 1.0, fixes are not backported.
