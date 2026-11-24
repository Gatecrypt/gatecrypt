/**
 * Staying signed in across builds: after a new deploy, a browser that signed
 * in to the build before is given the new build's key without the sign-in
 * screen, while the service allows it, and is shown the sign-in screen as
 * before when it does not.
 *
 * These tests rebuild a copy of the demo on an origin of its own, so the
 * other tests' builds are left alone.
 */
import { expect, test, type Page } from '@playwright/test';
import { buildDemo } from '../../dev/dev.mjs';
import { DEMO_API, PROJECT, RENEW_OUT_DIR, RENEW_SITE, SERVICE } from '../env.ts';
import {
  allowedEmail,
  expectApp,
  expectSignInScreen,
  loaderState,
  manifest,
  mock,
  record,
  signInWithCode,
  signInWithGoogle,
  storedKey,
} from './helpers.ts';

const SITE = RENEW_SITE;
const DEFAULTS: Parameters<typeof mock>[0] = {
  staySignedInDays: 30,
  staySignedInSeconds: null,
  renewDown: false,
  tokensIncluded: true,
  methods: ['google', 'email'],
  allow: ['alice@example.com', 'example.org'],
};

test.afterEach(async () => {
  await mock(DEFAULTS);
});

/** Deploys a new build of the site. Returns its keyId. */
async function deploy(): Promise<string> {
  await buildDemo({ serviceUrl: SERVICE, projectId: PROJECT.id, deployToken: PROJECT.deployToken, outDir: RENEW_OUT_DIR, demoApiUrl: DEMO_API });
  const res = await fetch(`${SITE}gatecrypt.json`, { cache: 'no-store' });
  return ((await res.json()) as { keyId: string }).keyId;
}

/** Counts the times the page asks for the sign-in page's settings: the loader does that only when it is about to show it. */
function signInScreens(page: Page): { count: number } {
  const seen = { count: 0 };
  page.on('request', (request) => {
    if (request.url().startsWith(`${SERVICE}/v1/projects/${PROJECT.id}/sign-in`)) seen.count++;
  });
  return seen;
}

const renewals = async (): Promise<number> => (await mock()).renewals;

async function signedIn(page: Page, email = allowedEmail('stay')): Promise<string> {
  await page.goto(SITE);
  await signInWithCode(page, email);
  await expectApp(page);
  return email;
}

test('after a new deploy, a signed-in visitor goes straight in, with the sign-in they had', async ({ page, context }) => {
  const recorded = await record(context);
  const email = await signedIn(page);
  const before = await storedKey(page);
  const screens = signInScreens(page);
  const renewed = await renewals();

  const keyId = await deploy();
  expect(keyId).not.toBe(before!.keyId);
  await page.reload();
  await expectApp(page);
  expect(screens.count).toBe(0);
  expect(await renewals()).toBe(renewed + 1);
  // The new build's key, kept the same way as one from a sign-in, beside the same grant and signing key.
  const after = await storedKey(page);
  expect(after).toMatchObject({ keyId, email, isCryptoKey: true, extractable: false, exportable: false, hasGrant: true });
  expect(after!.signKey).toEqual(before!.signKey);

  // Deploy after deploy, faster than the loader's guard against reload loops would allow sign-ins,
  // and the site's API still knows who is asking.
  for (let i = 0; i < 4; i++) {
    await deploy();
    await page.reload();
    await expectApp(page);
  }
  await page.getByRole('link', { name: 'Account' }).click();
  await expect(page.getByTestId('api-email')).toHaveText(email);
  expect(screens.count).toBe(0);
  expect(recorded.errors).toEqual([]);
});

test('a deep link after a deploy lands on its route, and a Google sign-in carries over too', async ({ page }) => {
  await page.goto(SITE);
  await signInWithGoogle(page, allowedEmail('google'));
  await expectApp(page);
  const screens = signInScreens(page);
  await deploy();
  await page.goto(`${SITE}account`);
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/account');
  expect(screens.count).toBe(0);
});

test('every open tab of the site carries over', async ({ page, context }) => {
  await signedIn(page);
  const other = await context.newPage();
  await other.goto(SITE);
  await expectApp(other);
  const keyId = await deploy();
  await Promise.all([page.reload(), other.reload()]);
  await expectApp(page);
  await expectApp(other);
  expect(await storedKey(other)).toMatchObject({ keyId });
});

test('with staying signed in off, a new deploy means signing in again', async ({ page }) => {
  await signedIn(page);
  await mock({ staySignedInDays: 0 });
  await deploy();
  await page.reload();
  await expectSignInScreen(page);
  // What could not be used is not kept.
  expect(await storedKey(page)).toBeNull();
  await signInWithCode(page, allowedEmail('again'));
  await expectApp(page);
});

test('a sign-in carries over only so long after it was made', async ({ page }) => {
  await mock({ staySignedInSeconds: 2 });
  await signedIn(page);
  await deploy();
  await page.reload();
  await expectApp(page);

  await page.waitForTimeout(2500);
  await deploy();
  await page.reload();
  await expectSignInScreen(page);
  expect(await storedKey(page)).toBeNull();
});

test('someone taken off the access list is told so at the next deploy, and gets no key', async ({ page }) => {
  await signedIn(page, allowedEmail('leaver'));
  // Everyone at example.org is taken off.
  await mock({ allow: ['alice@example.com'] });
  const renewed = await renewals();
  await deploy();
  await page.reload();
  await expect(loaderState(page)).toHaveAttribute('data-state', 'denied');
  await expect(page.getByText('That account is not authorized to view this site.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Email me a code' })).toBeVisible();
  expect(await storedKey(page)).toBeNull();
  expect(await renewals()).toBe(renewed);
  expect(await page.content()).not.toContain('GATECRYPT_DEMO_MARKER');
});

test('a sign-in by a way the project has switched off does not carry over', async ({ page }) => {
  await signedIn(page);
  await mock({ methods: ['google'] });
  await deploy();
  await page.reload();
  await expect(loaderState(page)).toHaveAttribute('data-state', 'signed-out');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Email me a code' })).toBeHidden();
});

test('a service that cannot be reached shows the sign-in screen, and keeps the sign-in for when it is back', async ({ page }) => {
  await signedIn(page);
  const before = await storedKey(page);
  await mock({ renewDown: true });
  await deploy();
  await page.reload();
  await expectSignInScreen(page);
  // Not forgotten over a bad moment.
  expect(await storedKey(page)).toMatchObject({ keyId: before!.keyId, hasGrant: true });

  await mock({ renewDown: false });
  await page.reload();
  await expectApp(page);
});

test('a build whose key the service no longer holds says so, and keeps the sign-in for the next deploy', async ({ page }) => {
  await signedIn(page);
  const before = await storedKey(page);
  const gone = await deploy();
  await mock({ dropKeys: [gone] });
  await page.reload();
  await expect(loaderState(page)).toHaveAttribute('data-state', 'error');
  await expect(page.getByText('The key for this version of the site is no longer available.')).toBeVisible();
  expect(await storedKey(page)).toMatchObject({ keyId: before!.keyId, hasGrant: true });

  await deploy();
  await page.reload();
  await expectApp(page);
});

test('signing out ends it: the next deploy asks for a sign-in', async ({ page }) => {
  await signedIn(page);
  await page.getByRole('link', { name: 'Account' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expectSignInScreen(page);
  await deploy();
  await page.reload();
  await expectSignInScreen(page);
});

test('a project whose visitors get no tokens still stays signed in; with neither, there is no grant to keep', async ({ page }) => {
  await mock({ tokensIncluded: false });
  await signedIn(page);
  expect(await storedKey(page)).toMatchObject({ hasGrant: true });
  await deploy();
  await page.reload();
  await expectApp(page);

  await mock({ staySignedInDays: 0 });
  await page.getByRole('link', { name: 'Account' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expectSignInScreen(page);
  await signInWithCode(page, allowedEmail('neither'));
  // Back where they signed out.
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
  expect(await storedKey(page)).toMatchObject({ hasGrant: false });
  await deploy();
  await page.reload();
  await expectSignInScreen(page);
});

test('a grant from another project, or a proof the service did not ask for, gets nothing', async ({ page }) => {
  await signedIn(page);
  const { keyId } = await manifest(page, SITE);
  // What a script on the page could try with what it can read: the grant, without this browser's key.
  const answers = await page.evaluate(
    async ({ service, project, keyId }) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open('gatecrypt:/');
        request.onsuccess = () => resolve(request.result);
      });
      const record = await new Promise<any>((resolve) => {
        const request = db.transaction('keys').objectStore('keys').get('current');
        request.onsuccess = () => resolve(request.result);
      });
      db.close();
      const ask = async (body: unknown) => {
        const res = await fetch(`${service}/v1/visitor/renew`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { status: res.status, body: await res.json() };
      };
      return {
        otherProject: await ask({ project: 'another', keyId, grant: record.grant }),
        noProof: await ask({ project, keyId, grant: record.grant, challenge: 'x', proof: 'A'.repeat(86) }),
      };
    },
    { service: SERVICE, project: PROJECT.id, keyId },
  );
  expect(answers.otherProject).toEqual({ status: 401, body: { ok: false, error: 'expired' } });
  expect(answers.noProof.status).toBe(200);
  expect(answers.noProof.body).toEqual({ ok: true, challenge: expect.any(String) });
});
