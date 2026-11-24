import { expect, type BrowserContext, type Page } from '@playwright/test';
import { MARKER, SERVICE } from '../env.ts';

interface MockState {
  project: {
    methods: string[];
    heading: string | null;
    message: string | null;
    name: string;
    origins: string[];
    allow: string[];
    /** Seconds a token lasts, and a sign-in. */
    tokenTtl: number;
    grantTtl: number;
    /** Whether the project's visitors get tokens at all. */
    tokensIncluded?: boolean;
    /** Token requests are answered with an error, as if the service were down. */
    tokensDown?: boolean;
    /** Days a sign-in carries over to new builds (0: never), or, for tests, seconds instead. */
    staySignedInDays?: number;
    staySignedInSeconds?: number | null;
    /** Requests for a newer build's key are answered with an error, as if the service were down. */
    renewDown?: boolean;
    /** Not kept: the keys of these builds are forgotten. */
    dropKeys?: string[];
  };
  codes: { email: string; code: string }[];
  keys: string[];
  /** How many tokens the service has given out, and how many keys without a sign-in. */
  tokens: number;
  renewals: number;
}

/** Reads the mock service's state, or changes its project when given a patch. */
export async function mock(patch?: Partial<MockState['project']>): Promise<MockState> {
  const res = await fetch(`${SERVICE}/__mock`, patch ? { method: 'POST', body: JSON.stringify(patch) } : undefined);
  return (await res.json()) as MockState;
}

/** The newest code "emailed" to an address. */
export async function emailCode(email: string): Promise<string> {
  const found = (await mock()).codes.findLast((sent) => sent.email === email);
  if (!found) throw new Error(`no code was sent to ${email}`);
  return found.code;
}

export interface Recorded {
  /** Every `message` event delivered to any page in the context. */
  messages: { page: string; origin: string; data: any }[];
  /** Uncaught errors in any page. */
  errors: string[];
}

/** Records what a browser context sees: postMessage deliveries (even across reloads) and errors. */
export async function record(context: BrowserContext): Promise<Recorded> {
  const recorded: Recorded = { messages: [], errors: [] };
  await context.exposeBinding('__gcRecord', (_source, entry) => {
    recorded.messages.push(entry);
  });
  await context.addInitScript(() => {
    window.addEventListener('message', (event) => {
      (window as any).__gcRecord({ page: location.origin, origin: event.origin, data: event.data });
    });
  });
  context.on('weberror', (error) => recorded.errors.push(error.error().message));
  return recorded;
}

export const loaderState = (page: Page) => page.locator('body');

/** The sign-in screen, offering both ways in. */
export async function expectSignInScreen(page: Page): Promise<void> {
  await expect(loaderState(page)).toHaveAttribute('data-state', 'signed-out');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Email me a code' })).toBeVisible();
}

/** Signs in through the mock "Google" pop-up, which believes whatever address it is given. Returns the pop-up. */
export async function signInWithGoogle(page: Page, email: string): Promise<Page> {
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: 'Continue with Google' }).click(),
  ]);
  await popup.getByLabel('Email').fill(email);
  await popup.getByRole('button', { name: 'Sign in' }).click();
  return popup;
}

/** Asks for an emailed code on the sign-in page, which then asks for the code. */
export async function askForCode(page: Page, email: string, labels = { email: 'Email', send: 'Email me a code' }): Promise<void> {
  await page.getByLabel(labels.email).fill(email);
  await page.getByRole('button', { name: labels.send }).click();
  await expect(loaderState(page)).toHaveAttribute('data-state', 'code');
}

export async function enterCode(page: Page, code: string, submit = 'Continue'): Promise<void> {
  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: submit, exact: true }).click();
}

/** Signs in with an emailed code, start to finish. */
export async function signInWithCode(page: Page, email: string): Promise<void> {
  await askForCode(page, email);
  await enterCode(page, await emailCode(email));
}

/** The decrypted demo app is on screen. */
export async function expectApp(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Welcome to the handbook' })).toBeVisible();
  await expect(page.getByTestId('home-secret')).toContainText(`${MARKER} (main chunk)`);
}

/** The key record the loader stored for a scope, as far as script can see it. */
export function storedKey(page: Page, scope = '/') {
  return page.evaluate(async (scopePath) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`gatecrypt:${scopePath}`);
      request.onupgradeneeded = () => request.result.createObjectStore('keys');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise<any>((resolve, reject) => {
      const request = db.transaction('keys').objectStore('keys').get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (!record) return null;
    const exportable = await crypto.subtle.exportKey('raw', record.key).then(
      () => true,
      () => false,
    );
    const signKey = record.signKey as CryptoKey | undefined;
    const signKeyExportable =
      !!signKey &&
      (await crypto.subtle.exportKey('pkcs8', signKey).then(
        () => true,
        () => false,
      ));
    return {
      keyId: record.keyId as string,
      projectId: record.projectId as string,
      email: record.email as string | undefined,
      isCryptoKey: record.key instanceof CryptoKey,
      extractable: record.key.extractable as boolean,
      usages: record.key.usages as string[],
      exportable,
      // What tokens are asked for with: the service's grant, and this browser's own signing key.
      service: record.service as string | undefined,
      hasGrant: typeof record.grant === 'string' && record.grant.length > 20,
      signKey: signKey && { type: signKey.type, extractable: signKey.extractable, usages: [...signKey.usages], exportable: signKeyExportable },
    };
  }, scope);
}

export const manifest = async (page: Page, site: string): Promise<{ keyId: string; projectId: string; index: string }> =>
  (await page.request.get(`${site}gatecrypt.json`)).json();

/** An address the mock project lets in (it allows all of example.org), unique per call. */
export const allowedEmail = (name: string): string => `${name}-${Math.random().toString(36).slice(2, 8)}@example.org`;
