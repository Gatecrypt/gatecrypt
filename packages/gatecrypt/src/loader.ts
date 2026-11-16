/**
 * The plaintext loader. Inlined into index.html by the build plugin as a
 * classic script: <script data-base="/site/base/">…</script>. No dependencies.
 *
 * The page (see loader-html.ts) provides the heading, logo and status message,
 * the sign-in controls (a Google button, an email form, a code form) and one
 * general-purpose button. The loader shows the ones the current state needs
 * and mirrors the state to <body data-state>.
 *
 * Which ways of signing in are offered, what the page says and how it looks
 * are set in the dashboard and fetched when the page opens, so they change
 * without rebuilding the site.
 */
import {
  API,
  DEVICE_KEY,
  MANIFEST_NAME,
  MESSAGE_TYPE,
  SW_NAME,
  b64urlDecode,
  b64urlEncode,
  decryptBlob,
  importKey,
  indexAad,
  parseManifest,
  type PublicManifest,
  type ResultMessage,
} from './format.js';
import { clearKey, getKey, putKey } from './idb.js';
import { fill, mergeText } from './text.js';

const script = document.currentScript as HTMLScriptElement;
const base = new URL(script.dataset.base || './', location.href);
const scope = base.pathname;
/** The page's sentences: English, with whatever the build replaced. */
const text = mergeText(JSON.parse(script.dataset.text || '{}'));
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById('gc-' + id) as T;
const message = $('m');
const button = $<HTMLButtonElement>('b');
const google = $<HTMLButtonElement>('g');
const or = $('o');
const emailForm = $<HTMLFormElement>('e');
const emailInput = $<HTMLInputElement>('a');
const codeForm = $<HTMLFormElement>('c');
const codeInput = $<HTMLInputElement>('d');
const controls = [google, or, emailForm, codeForm];
const RELOADS = 'gatecrypt:reloads:' + scope;

let manifest: PublicManifest;
/** Until the service says what the project is called, or what its owner wants said instead. */
let signInMessage = text.signIn;
/** The ways of signing in this project offers. */
let methods: unknown[] = [];
let action: (() => void) | undefined;
let stopWaiting: (() => void) | undefined;
/**
 * This browser's own signing key, made for this sign-in. The service is told
 * its public half, and afterwards gives tokens only to whoever can sign with
 * the private half, which never leaves the browser.
 */
let signKey: CryptoKey;
let pub = '';
/** The emailed code being waited for: who it went to, and the id that redeems it. */
let email = '';
let flow = '';

button.onclick = () => action?.();
google.onclick = signInWithGoogle;
emailForm.onsubmit = (event) => {
  event.preventDefault();
  void sendCode();
};
codeForm.onsubmit = (event) => {
  event.preventDefault();
  void checkCode();
};

/** Shows a state: its message, the sign-in controls it uses, and optionally the general button. */
function show(state: string, sentence: string, label?: string, onClick?: () => void, visible: unknown[] = []): void {
  stopWaiting?.();
  document.body.dataset.state = state;
  message.textContent = sentence;
  for (const control of controls) control.hidden = !visible.includes(control);
  button.hidden = !label;
  if (label) button.textContent = label;
  action = onClick;
  busy(false);
}

/** While a request is out, nothing on the page can be pressed twice. */
function busy(on: boolean): void {
  for (const control of document.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input')) {
    control.disabled = on;
  }
}

const offers = (method: string): boolean => methods.includes(method);

/** The sign-in screen. `state` is "signed-out", or the reason the visitor is back here. */
function signedOut(sentence = signInMessage, state = 'signed-out'): void {
  show(state, sentence, undefined, undefined, [
    offers('google') && google,
    offers('google') && offers('email') && or,
    offers('email') && emailForm,
  ]);
}

async function boot(): Promise<void> {
  show('loading', text.loading);
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !window.indexedDB || !crypto.subtle) {
    return show('unsupported', text.unsupported);
  }
  try {
    const res = await fetch(new URL(MANIFEST_NAME, base), { cache: 'no-store' });
    if (!res.ok) throw 0;
    manifest = parseManifest(await res.json());
  } catch {
    return show('error', text.loadFailed, text.retry, boot);
  }
  const stored = await getKey(scope).catch(() => undefined);
  if (stored && stored.keyId === manifest.keyId) return start();
  // A key for another build (the site was redeployed): drop it and sign in again.
  if (stored) await clearKey(scope).catch(() => undefined);
  await openSignIn();
}

/**
 * Asks the service what this project's sign-in page offers and how it should
 * look, applies that, and shows the sign-in screen.
 */
async function openSignIn(): Promise<void> {
  let look: Record<string, unknown>;
  try {
    const res = await fetch(`${manifest.service}${API}/projects/${encodeURIComponent(manifest.projectId)}/sign-in`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (res.status === 404) {
      return show('error', text.noProject);
    }
    if (!res.ok) throw 0;
    look = (await res.json()) as Record<string, unknown>;
  } catch {
    return show('unreachable', text.unreachable, text.retry, () => {
      show('unreachable', text.checking);
      void openSignIn();
    });
  }
  methods = Array.isArray(look.methods) ? look.methods : [];
  // Made now, not at the click: a pop-up must open the moment its button is pressed.
  const pair = await crypto.subtle.generateKey(DEVICE_KEY, false, ['sign']);
  signKey = pair.privateKey;
  pub = b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  // With Google above it, the email button is the quieter of the two.
  emailForm.querySelector('button')!.className = offers('google') ? 's' : '';

  const string = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
  const heading = string(look.heading);
  if (heading) document.title = $('h').textContent = heading;
  const name = string(look.name);
  signInMessage = string(look.message) ?? (name ? fill(text.signInTo, { name }) : text.signIn);
  const logo = string(look.logo);
  // Only ever an image from the service itself.
  if (logo && logo.startsWith(manifest.service + '/')) {
    const image = $<HTMLImageElement>('l');
    image.src = logo;
    image.hidden = false;
  }
  signedOut();
}

// ------------------------------------------------------------------- Google

/** Opens the service's popup, which goes straight to Google and posts the key back to this page. */
function signInWithGoogle(): void {
  const req = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
  const url =
    `${manifest.service}${API}/visitor/google?project=${encodeURIComponent(manifest.projectId)}` +
    `&keyId=${encodeURIComponent(manifest.keyId)}&origin=${encodeURIComponent(location.origin)}&req=${req}&pub=${pub}`;
  // Must run inside the click handler or popup blockers step in.
  const popup = window.open(url, 'gatecrypt-signin', 'popup,width=480,height=640');
  if (!popup) {
    return signedOut(text.popupBlocked, 'blocked');
  }
  show('waiting', text.waiting, text.startOver, () => {
    popup.close();
    signedOut();
  });

  const serviceOrigin = new URL(manifest.service).origin;
  const onMessage = (event: MessageEvent): void => {
    const data = event.data as ResultMessage | null;
    if (event.origin !== serviceOrigin || event.source !== popup) return;
    if (!data || data.type !== MESSAGE_TYPE || data.req !== req) return;
    if (data.ok) void accept(data);
    else refused(data.error);
  };
  // The popup closes itself right after posting; give the message a moment to land.
  let closedAt = 0;
  const poll = setInterval(() => {
    if (!popup.closed) return;
    if (!closedAt) closedAt = Date.now();
    else if (Date.now() - closedAt > 1000) signedOut(text.notCompleted);
  }, 300);
  // Whatever is shown next ends the wait.
  stopWaiting = (): void => {
    removeEventListener('message', onMessage);
    clearInterval(poll);
    stopWaiting = undefined;
  };
  addEventListener('message', onMessage);
}

// --------------------------------------------------------------- email code

/** A request to the service from this page. Undefined when there was no usable answer. */
async function post(path: string, body: unknown): Promise<Record<string, any> | undefined> {
  busy(true);
  try {
    const res = await fetch(manifest.service + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    return (await res.json()) as Record<string, any>;
  } catch {
    return undefined;
  }
}

async function sendCode(): Promise<void> {
  email = emailInput.value.trim();
  const answer = await post(API + '/visitor/email', { project: manifest.projectId, keyId: manifest.keyId, email, pub });
  if (!answer?.flow) return refused(answer?.error);
  flow = answer.flow;
  enterCode();
}

/** The code screen. The wording is the same whether or not the address has access. */
function enterCode(sentence = fill(text.codeSent, { email }), state = 'code'): void {
  show(state, sentence, text.otherEmail, () => signedOut(), [codeForm]);
  codeInput.value = '';
  codeInput.focus();
}

async function checkCode(): Promise<void> {
  const answer = await post(API + '/visitor/email/verify', { flow, code: codeInput.value });
  if (answer?.ok) return accept(answer);
  if (!answer) return enterCode(text.unreachable, 'wrong');
  if (answer.error === 'wrong_code') return enterCode(text.wrongCode, 'wrong');
  refused(answer.error);
}

// ------------------------------------------------------------------ outcome

/** Why a sign-in did not end with a key, in the visitor's words. The rest are "Sign-in failed". */
const REASONS: Record<string, string> = {
  not_authorized: text.notAuthorized,
  email_unverified: text.emailUnverified,
  invalid_email: text.invalidEmail,
  too_many_codes: text.tooManyCodes,
  too_many_tries: text.tooManyTries,
  expired: text.codeExpired,
  origin_not_registered: text.originNotRegistered,
  visitor_limit: text.visitorLimit,
};

function refused(error?: string): void {
  if (!error) return signedOut(text.unreachable, 'failed');
  if (error === 'key_unavailable') {
    return show('error', text.keyUnavailable);
  }
  // The project's sign-in methods changed while this page was open: fetch them again.
  if (error === 'method_unavailable') return void openSignIn();
  signedOut(
    REASONS[error] ?? text.failed,
    error === 'not_authorized' || error === 'email_unverified' ? 'denied' : 'failed',
  );
}

/** What a successful sign-in is answered with: the key, who it is for, and the grant that tokens are asked with. */
async function accept(answer: { keyId?: unknown; key?: unknown; email?: unknown; grant?: unknown }): Promise<void> {
  show('starting', text.unlocking);
  const { keyId, email: address, grant } = answer;
  try {
    // A deliberate sign-in is not a reload loop: start the count afresh.
    sessionStorage.removeItem(RELOADS);
    if (keyId !== manifest.keyId) throw 0;
    const key = await importKey(b64urlDecode(answer.key as string), ['decrypt']);
    // Prove the key opens this build before keeping it.
    const res = await fetch(new URL(manifest.index, base));
    if (!res.ok) throw 0;
    await decryptBlob(key, await res.arrayBuffer(), indexAad(keyId));
    await putKey(scope, {
      keyId,
      projectId: manifest.projectId,
      key,
      ...(typeof address === 'string' && address ? { email: address } : {}),
      ...(typeof grant === 'string' && grant ? { service: manifest.service, grant, signKey } : {}),
    });
  } catch {
    return show('error', text.wrongKey, text.reload, () => location.reload());
  }
  start();
}

/** Hands over to the service worker: once it is active, a reload is answered with the decrypted site. */
async function start(): Promise<void> {
  show('starting', text.unlocking);
  try {
    // If the loader keeps coming back, the worker is not taking over. Stop instead of looping.
    const now = Date.now();
    const last = JSON.parse(sessionStorage.getItem(RELOADS) || '[0,0]') as [number, number];
    const count = now - last[1] < 10_000 ? last[0] + 1 : 1;
    if (count > 3) {
      sessionStorage.removeItem(RELOADS);
      throw 0;
    }
    sessionStorage.setItem(RELOADS, JSON.stringify([count, now]));
    await navigator.serviceWorker.register(new URL(SW_NAME, base), { scope });
    await navigator.serviceWorker.ready;
    location.reload();
  } catch {
    show('error', text.cannotStart, text.tryAgain, () => location.reload());
  }
}

boot();
