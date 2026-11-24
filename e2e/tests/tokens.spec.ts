import { expect, test, type Page } from '@playwright/test';
import { DEMO_API, SERVICE, SITE, SUBPATH_SITE } from '../env.ts';
import { allowedEmail, expectApp, expectSignInScreen, mock, record, signInWithCode, signInWithGoogle, storedKey } from './helpers.ts';

/** What the demo's API (examples/apis/node) says about who is asking, as the Account page shows it. */
const apiSays = (page: Page) => page.getByTestId('api-email');
const openAccount = (page: Page) => page.getByRole('link', { name: 'Account' }).click();
const tokensGiven = async (): Promise<number> => (await mock()).tokens;

/** Token and sign-in lifetimes are the mock's to set: put them back whatever a test did. */
test.afterEach(async () => {
  await mock({ tokenTtl: 600, grantTtl: 30 * 86400, tokensDown: false, tokensIncluded: true, staySignedInDays: 30, allow: ['alice@example.com', 'example.org'] });
});

test("the site's API is told who the visitor is, with nothing in the site's code but a fetch", async ({ page, context }) => {
  const recorded = await record(context);
  const email = allowedEmail('api');
  await page.goto(SITE);
  await signInWithCode(page, email);
  await expectApp(page);
  // Nothing is asked for until the site calls its API.
  const before = await tokensGiven();

  await openAccount(page);
  await expect(apiSays(page)).toHaveText(email);

  // By hand, with getVisitorToken(): the same token, not a second one.
  await page.getByRole('button', { name: 'Ask with getVisitorToken()' }).click();
  await expect(page.getByTestId('api-manual')).toHaveText(email);
  expect(await tokensGiven()).toBe(before + 1);

  // A reload, and a visit straight to the page, use the copy this browser kept.
  await page.reload();
  await expect(apiSays(page)).toHaveText(email);
  await page.goto(`${SITE}account`);
  await expect(apiSays(page)).toHaveText(email);
  expect(await tokensGiven()).toBe(before + 1);
  expect(recorded.errors).toEqual([]);
});

test('the token is what the API checks: without it, or with a spoiled one, the API refuses', async ({ page }) => {
  await page.goto(SITE);
  await signInWithCode(page, allowedEmail('checks'));
  await expectApp(page);

  const statuses = await page.evaluate(async (api) => {
    const status = async (headers: Record<string, string>): Promise<number> => (await fetch(`${api}/api/me`, { headers })).status;
    return {
      // An Authorization header the page set itself is left alone, so these reach the API as they are.
      garbage: await status({ Authorization: 'Bearer not-a-token' }),
      other: await status({ Authorization: 'Basic dXNlcjpwYXNz' }),
      plain: await status({}),
    };
  }, DEMO_API);
  expect(statuses).toEqual({ garbage: 401, other: 401, plain: 200 });
  // A program that is not the site has no token to send.
  expect((await fetch(`${DEMO_API}/api/me`)).status).toBe(401);
});

test('the token goes to the API and nowhere else', async ({ page }) => {
  const email = allowedEmail('only');
  await page.goto(SITE);
  await signInWithCode(page, email);
  await expectApp(page);
  await openAccount(page);
  await expect(apiSays(page)).toHaveText(email);

  const seen = await page.evaluate(
    async ({ service }) => {
      const echo = async (init?: RequestInit): Promise<string | null> =>
        ((await (await fetch(`${service}/__mock/echo`, init)).json()) as { authorization: string | null }).authorization;
      return {
        otherOrigin: await echo(),
        otherOriginPost: await echo({ method: 'POST', body: '{}' }),
        ownFile: (await fetch('/notices.json')).ok,
      };
    },
    { service: SERVICE },
  );
  expect(seen).toEqual({ otherOrigin: null, otherOriginPost: null, ownFile: true });
});

test('Google sign-in, and a site under a path, get tokens the same way', async ({ page, context }) => {
  await page.goto(SITE);
  await signInWithGoogle(page, 'alice@example.com');
  await expectApp(page);
  expect(await storedKey(page)).toMatchObject({
    service: SERVICE,
    hasGrant: true,
    signKey: { type: 'private', extractable: false, usages: ['sign'], exportable: false },
  });
  await openAccount(page);
  await expect(apiSays(page)).toHaveText('alice@example.com');

  const sub = await context.newPage();
  const email = allowedEmail('sub-api');
  await sub.goto(SUBPATH_SITE);
  await signInWithCode(sub, email);
  await expectApp(sub);
  await openAccount(sub);
  // Each site has its own sign-in, even on one browser.
  await expect(apiSays(sub)).toHaveText(email);
});

test('a token that runs out is replaced without the visitor noticing', async ({ page }) => {
  await mock({ tokenTtl: 2 });
  const email = allowedEmail('renew');
  await page.goto(SITE);
  await signInWithCode(page, email);
  await expectApp(page);
  await openAccount(page);
  await expect(apiSays(page)).toHaveText(email);
  const before = await tokensGiven();

  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Ask again' }).click();
  await expect(apiSays(page)).toHaveText(email);
  expect(await tokensGiven()).toBeGreaterThan(before);
});

for (const how of ['a call to the API', 'getVisitorToken()'] as const) {
  test(`someone taken off the access list is signed out at their next token, by ${how}`, async ({ page }) => {
    const email = `leaver-${Math.random().toString(36).slice(2, 8)}@partner.test`;
    await mock({ tokenTtl: 2, allow: ['alice@example.com', 'example.org', email] });
    await page.goto(SITE);
    await signInWithCode(page, email);
    await expectApp(page);
    await openAccount(page);
    await expect(apiSays(page)).toHaveText(email);

    await mock({ allow: ['alice@example.com', 'example.org'] });
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: how === 'getVisitorToken()' ? 'Ask with getVisitorToken()' : 'Ask again' }).click();

    // The page is replaced by the sign-in screen, and the key is gone from this browser.
    await expectSignInScreen(page);
    expect(await storedKey(page)).toBeNull();
    expect(await page.content()).not.toContain('Account');
    // And they cannot get back in.
    await signInWithCode(page, email).catch(() => undefined);
    await expect(page.getByRole('heading', { name: 'Welcome to the handbook' })).toBeHidden();
  });
}

test('a sign-in lasts only so long: after that, the next token asks the visitor to sign in again', async ({ page }) => {
  await mock({ grantTtl: 1 });
  const email = allowedEmail('lapsed');
  await page.goto(SITE);
  await signInWithCode(page, email);
  await expectApp(page);
  await page.waitForTimeout(1500);
  await openAccount(page);
  await expectSignInScreen(page);

  // Signing in again is all it takes.
  await mock({ grantTtl: 30 * 86400 });
  await signInWithCode(page, email);
  await expectApp(page);
  await openAccount(page);
  await expect(apiSays(page)).toHaveText(email);
});

test('a service that is down fails the request, and does not sign the visitor out', async ({ page }) => {
  await mock({ tokenTtl: 2 });
  const email = allowedEmail('offline');
  await page.goto(SITE);
  await signInWithCode(page, email);
  await expectApp(page);
  await openAccount(page);
  await expect(apiSays(page)).toHaveText(email);
  await page.waitForTimeout(2500);

  await mock({ tokensDown: true });
  // Either way the call fails like any call that could not be made; it never reaches the API without a token.
  await page.getByRole('button', { name: 'Ask with getVisitorToken()' }).click();
  await expect(page.getByTestId('api-manual')).toContainText('failed');
  await page.getByRole('button', { name: 'Ask again' }).click();
  await expect(apiSays(page)).toContainText('failed');
  // Nobody was signed out over it.
  expect(await storedKey(page)).toMatchObject({ hasGrant: true });
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();

  await mock({ tokensDown: false });
  await page.getByRole('button', { name: 'Ask with getVisitorToken()' }).click();
  await expect(page.getByTestId('api-manual')).toHaveText(email);
  await page.getByRole('button', { name: 'Ask again' }).click();
  await expect(apiSays(page)).toHaveText(email);
});

test('a project whose visitors get no tokens still opens; its API calls just carry none', async ({ page }) => {
  // Nor do they stay signed in across builds, so there is no grant at all.
  await mock({ tokensIncluded: false, staySignedInDays: 0 });
  const email = allowedEmail('plain');
  await page.goto(SITE);
  await signInWithCode(page, email);
  await expectApp(page);
  expect(await storedKey(page)).toMatchObject({ hasGrant: false });
  const before = await tokensGiven();
  await openAccount(page);
  await expect(apiSays(page)).toContainText('refused (401');
  await page.getByRole('button', { name: 'Ask with getVisitorToken()' }).click();
  await expect(page.getByTestId('api-manual')).toContainText('refused (401');
  // Still signed in, and nothing was asked of the service.
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
  expect(await tokensGiven()).toBe(before);
});

test('tokens that stop being included end quietly: the visitor stays signed in', async ({ page }) => {
  await mock({ tokenTtl: 2 });
  const email = allowedEmail('downgrade');
  await page.goto(SITE);
  await signInWithCode(page, email);
  await expectApp(page);
  await openAccount(page);
  await expect(apiSays(page)).toHaveText(email);

  await mock({ tokensIncluded: false });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Ask again' }).click();
  await expect(apiSays(page)).toContainText('refused (401');
  expect(await storedKey(page)).toMatchObject({ hasGrant: true });
  await page.getByRole('link', { name: 'Home' }).click();
  await expectApp(page);
});

test('signing out forgets the token along with the key', async ({ page }) => {
  await page.goto(SITE);
  await signInWithCode(page, allowedEmail('forget'));
  await expectApp(page);
  await openAccount(page);
  await expect(apiSays(page)).not.toHaveText('…');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expectSignInScreen(page);
  const left = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('gatecrypt:/');
      request.onsuccess = () => resolve(request.result);
    });
    const keys = await new Promise<IDBValidKey[]>((resolve) => {
      const request = db.transaction('keys').objectStore('keys').getAllKeys();
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return keys;
  });
  expect(left).toEqual([]);
});
