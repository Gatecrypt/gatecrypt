/** Addresses of the test stack. Separate from `pnpm dev`, so both can run at once. */
export const SERVICE = 'http://localhost:9887';

/** The demo at the root of a registered origin. */
export const SITE = 'http://localhost:4373/';
/** The same files on an origin the project has not registered. */
export const UNREGISTERED_SITE = 'http://localhost:4374/';
/** The demo built with base "/handbook/", like a GitHub Pages project site. */
export const SUBPATH_SITE = 'http://localhost:4375/handbook/';
/** Two plain HTML pages encrypted with the CLI, in German, without the single-page-app fallback. */
export const CLI_SITE = 'http://localhost:4376/';

/** The demo's own API (examples/apis/node), which checks visitor tokens. */
export const DEMO_API = 'http://localhost:4377';

export const OUT_DIR = 'dist-e2e';
export const SUBPATH_OUT_DIR = 'dist-e2e-sub';

export const PROJECT = { id: 'demo', deployToken: 'gcd_mock' };
export const MARKER = 'GATECRYPT_DEMO_MARKER';
export const CLI_MARKER = 'GATECRYPT_CLI_MARKER';

/** Sentences the CLI site replaces. */
export const GERMAN = {
  title: 'Nur für Mitglieder',
  signInTo: 'Anmelden bei {name}',
  sendCode: 'Code per E-Mail senden',
  emailLabel: 'E-Mail',
  codeSent: 'Falls {email} Zugriff hat, ist ein Code unterwegs.',
  submitCode: 'Weiter',
  wrongCode: 'Dieser Code stimmt nicht.',
};
