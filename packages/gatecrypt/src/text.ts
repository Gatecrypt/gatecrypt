/**
 * Every sentence the sign-in page can show, in English. A build can replace
 * any of them (the `text` option) to translate the page or change its wording.
 * `{name}` and `{email}` are filled in when the sentence is shown.
 *
 * The heading and the sign-in message can also be set in the dashboard, which
 * wins over what is built in.
 */
export const DEFAULT_TEXT = {
  /** Heading and tab title. */
  title: 'Protected page',
  /** Under the heading, until the service says what the project is called. */
  signIn: 'Sign in to continue',
  /** Under the heading, once it has. */
  signInTo: 'Sign in to access {name}',
  google: 'Continue with Google',
  or: 'or',
  emailLabel: 'Email',
  emailPlaceholder: 'you@company.com',
  sendCode: 'Email me a code',
  codeLabel: 'Code',
  submitCode: 'Continue',
  otherEmail: 'Use a different email',
  startOver: 'Start over',
  retry: 'Retry',
  reload: 'Reload',
  tryAgain: 'Try again',
  loading: 'Loading…',
  checking: 'Checking…',
  unlocking: 'Unlocking…',
  noScript: 'This site needs JavaScript.',
  waiting: 'Finish signing in in the window that just opened.',
  codeSent: 'If {email} has access to this site, a 6-digit code is on its way to it.',
  wrongCode: 'That code is not right. Check it and try again.',
  notCompleted: 'Sign-in was not completed.',
  popupBlocked: 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.',
  unreachable: 'The sign-in service cannot be reached right now. Try again in a moment.',
  unsupported:
    'This browser cannot open this site. It needs HTTPS, service workers and IndexedDB, which private windows in some browsers turn off.',
  loadFailed: 'Could not load this site. Check your connection and try again.',
  noProject: 'This site is not connected to a sign-in project. If you own it, check its project ID.',
  notAuthorized: 'That account is not authorized to view this site.',
  emailUnverified: "That account's email address has not been verified.",
  invalidEmail: 'Enter your email address.',
  tooManyCodes: 'Too many codes were requested for that address. Try again in a few minutes.',
  tooManyTries: 'Too many wrong codes. Ask for a new one.',
  codeExpired: 'That code has expired. Ask for a new one.',
  originNotRegistered:
    "This site's address is not registered with the sign-in service. If you own the site, add its address in the Gatecrypt dashboard.",
  visitorLimit: 'This site has reached its visitor limit for this month. Ask the site owner for help.',
  keyUnavailable: 'The key for this version of the site is no longer available. The site needs to be redeployed.',
  failed: 'Sign-in failed. Try again.',
  wrongKey: 'The key that was issued does not open this version of the site.',
  cannotStart: 'Could not start the site in this browser.',
};

export type LoaderText = typeof DEFAULT_TEXT;

/** The defaults with a build's replacements applied. Anything that is not a known key holding text is ignored. */
export function mergeText(overrides: unknown): LoaderText {
  const text = { ...DEFAULT_TEXT };
  if (overrides && typeof overrides === 'object') {
    for (const [key, value] of Object.entries(overrides)) {
      if (Object.hasOwn(DEFAULT_TEXT, key) && typeof value === 'string' && value) text[key as keyof LoaderText] = value;
    }
  }
  return text;
}

/** Throws, naming the problem, if `overrides` is not a map from known keys to text. For build-time input. */
export function checkText(overrides: unknown): Partial<LoaderText> {
  if (overrides === undefined) return {};
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new Error('Gatecrypt: text must be an object of sign-in page sentences');
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(DEFAULT_TEXT, key)) {
      throw new Error(`Gatecrypt: text.${key} is not a sentence of the sign-in page. Known: ${Object.keys(DEFAULT_TEXT).join(', ')}`);
    }
    if (typeof value !== 'string' || !value) throw new Error(`Gatecrypt: text.${key} must be non-empty text`);
  }
  return overrides as Partial<LoaderText>;
}

export const fill = (sentence: string, values: Record<string, string>): string =>
  sentence.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
