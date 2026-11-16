import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { DEMO_DIR, buildDemo } from '../../dev/dev.mjs';
import { CLI_MARKER, CLI_SITE, DEMO_API, GERMAN, MARKER, OUT_DIR, PROJECT, SERVICE, SITE, SUBPATH_OUT_DIR, SUBPATH_SITE, UNREGISTERED_SITE } from '../env.ts';
import {
  allowedEmail,
  askForCode,
  emailCode,
  enterCode,
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

for (const outDir of [OUT_DIR, SUBPATH_OUT_DIR]) {
  test(`the build output holds no plaintext (${outDir})`, async () => {
    const dir = path.join(DEMO_DIR, outDir);
    const files = new Map<string, Buffer>();
    for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const full = path.join(entry.parentPath, entry.name);
      files.set(path.relative(dir, full).split(path.sep).join('/'), await readFile(full));
    }
    // The marker is in every kind of source file, so its absence below means something.
    for (const source of ['index.html', 'src/marker.ts', 'src/styles.css', 'src/logo.svg', 'public/notices.json']) {
      expect((await readFile(path.join(DEMO_DIR, source), 'utf8')).includes(MARKER), source).toBe(true);
    }
    const needles = [Buffer.from(MARKER), Buffer.from(MARKER, 'utf16le'), Buffer.from('Acme handbook'), Buffer.from('createRoot')];
    for (const [name, content] of files) {
      for (const needle of needles) expect(content.includes(needle), `${name} contains plaintext`).toBe(false);
    }
    const names = [...files.keys()].sort();
    const blobs = names.filter((name) => /^gatecrypt\/[0-9a-f]{32}\.bin$/.test(name));
    expect(names.filter((name) => !blobs.includes(name))).toEqual(['404.html', 'gatecrypt-sw.js', 'gatecrypt.json', 'index.html']);
    expect(blobs.length).toBeGreaterThanOrEqual(7);
  });
}

test('an emailed code opens the site, and every kind of file is decrypted', async ({ page, context }) => {
  const recorded = await record(context);
  const email = allowedEmail('codes');
  await page.goto(SITE);
  await expectSignInScreen(page);
  // Before sign-in the page is the loader and nothing else.
  await expect(page).toHaveTitle('Sign in to continue');
  await expect(page.getByRole('status')).toHaveText('Sign in to access Team handbook');
  await expect(page.getByRole('link', { name: 'Powered by Gatecrypt' })).toHaveAttribute('href', 'https://gatecrypt.dev');
  expect(await page.content()).not.toContain(MARKER);

  await askForCode(page, email);
  await expect(page.getByRole('status')).toHaveText(`If ${email} has access to this site, a 6-digit code is on its way to it.`);
  await expect(page.getByLabel('Code')).toBeFocused();

  // A wrong code is refused and the page stays put.
  const code = await emailCode(email);
  await enterCode(page, code === '000000' ? '111111' : '000000');
  await expect(loaderState(page)).toHaveAttribute('data-state', 'wrong');
  await expect(page.getByRole('status')).toHaveText('That code is not right. Check it and try again.');

  await enterCode(page, code);
  await expectApp(page);

  // HTML, main chunk, stylesheet, imported asset, file from public/.
  await expect(page).toHaveTitle(`Acme handbook (${MARKER})`);
  await expect(page.getByTestId('notices')).toContainText(`${MARKER} (public file)`);
  const footer = await page.evaluate(() => getComputedStyle(document.querySelector('main')!, '::after').content);
  expect(footer).toContain(`${MARKER} (stylesheet)`);
  const logo = page.getByRole('img', { name: 'Acme logo' });
  await expect(logo).toHaveJSProperty('complete', true);
  expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  // No pop-up and no message between windows; the key is kept where script cannot read it.
  expect(context.pages()).toHaveLength(1);
  expect(recorded.messages).toEqual([]);
  const { keyId } = await manifest(page, SITE);
  expect(await storedKey(page)).toEqual({
    keyId,
    projectId: PROJECT.id,
    email,
    isCryptoKey: true,
    extractable: false,
    usages: ['decrypt'],
    exportable: false,
    service: SERVICE,
    hasGrant: true,
    signKey: { type: 'private', extractable: false, usages: ['sign'], exportable: false },
  });
  // The app can say who signed in.
  await expect(page.getByTestId('visitor')).toHaveText(email);
  expect(recorded.errors).toEqual([]);
});

test('Google sign-in opens the site through a pop-up that answers only the page that opened it', async ({ page, context }) => {
  const recorded = await record(context);
  await page.goto(SITE);
  const popup = await signInWithGoogle(page, 'alice@example.com');
  await expectApp(page);
  await expect.poll(() => popup.isClosed()).toBe(true);

  const { keyId } = await manifest(page, SITE);
  expect(recorded.messages).toHaveLength(1);
  expect(recorded.messages[0]).toMatchObject({
    page: new URL(SITE).origin,
    origin: SERVICE,
    data: { type: 'gatecrypt:result', ok: true, keyId },
  });
  expect(await storedKey(page)).toMatchObject({ keyId, email: 'alice@example.com', extractable: false, exportable: false });
  await expect(page.getByTestId('visitor')).toHaveText('alice@example.com');
  expect(recorded.errors).toEqual([]);
});

test('someone who is not on the list gets nowhere, by either way in', async ({ page }) => {
  await page.goto(SITE);
  const popup = await signInWithGoogle(page, 'mallory@evil.test');
  await expect(loaderState(page)).toHaveAttribute('data-state', 'denied');
  await expect(page.getByRole('status')).toHaveText('That account is not authorized to view this site.');
  await popup.close();

  await askForCode(page, 'mallory@evil.test');
  // The page says what it says to everyone, and no code exists.
  await expect(page.getByRole('status')).toHaveText('If mallory@evil.test has access to this site, a 6-digit code is on its way to it.');
  expect((await mock()).codes.some((sent) => sent.email === 'mallory@evil.test')).toBe(false);
  await enterCode(page, '123456');
  await expect(page.getByRole('status')).toHaveText('That code is not right. Check it and try again.');

  expect(await storedKey(page)).toBeNull();
  expect(await page.content()).not.toContain(MARKER);
});

test('closing the pop-up, or starting over, returns to the sign-in screen', async ({ page }) => {
  await page.goto(SITE);
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Continue with Google' }).click()]);
  await expect(loaderState(page)).toHaveAttribute('data-state', 'waiting');
  await popup.close();
  await expect(page.getByRole('status')).toHaveText('Sign-in was not completed.');
  await expectSignInScreen(page);

  const [second] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Continue with Google' }).click()]);
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect.poll(() => second.isClosed()).toBe(true);
  await expectSignInScreen(page);
});

test('routes work by link, by reload and by deep link, including the lazy one', async ({ page }) => {
  await page.goto(SITE);
  await signInWithCode(page, allowedEmail('routes'));
  await expectApp(page);

  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page.getByTestId('reports-secret')).toContainText(`${MARKER} (lazy chunk)`);
  await page.reload();
  await expect(page.getByTestId('reports-secret')).toContainText(`${MARKER} (lazy chunk)`);
  await page.goto(`${SITE}reports/q3`);
  await expect(page.getByRole('heading', { name: 'Report q3' })).toBeVisible();
  await page.goto(`${SITE}no/such/page`);
  await expect(page.getByRole('heading', { name: 'No such page' })).toBeVisible();
});

test('a first visit to a deep link signs in and lands on that route', async ({ page }) => {
  // The host answers with its 404 page, which is the loader.
  const response = await page.goto(`${SITE}reports/q3`);
  expect(response!.status()).toBe(404);
  await expectSignInScreen(page);
  await signInWithCode(page, allowedEmail('deep'));
  await expect(page.getByRole('heading', { name: 'Report q3' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/reports/q3');
});

test('signing out forgets the key and shows the sign-in page again', async ({ page }) => {
  await page.goto(SITE);
  await signInWithCode(page, allowedEmail('out'));
  await expectApp(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expectSignInScreen(page);
  expect(await storedKey(page)).toBeNull();
  expect(await page.content()).not.toContain(MARKER);
});

test('a site under a path works, and keeps its key apart from the root', async ({ page }) => {
  await page.goto(SUBPATH_SITE);
  await expectSignInScreen(page);
  await signInWithCode(page, allowedEmail('sub'));
  await expectApp(page);
  expect(await storedKey(page, '/handbook/')).toMatchObject({ extractable: false });
  expect(await storedKey(page, '/')).toBeNull();
  await page.goto(`${SUBPATH_SITE}reports`);
  await expect(page.getByTestId('reports-secret')).toContainText(MARKER);
});

test('a site address that is not registered is told so, and gets no key', async ({ page }) => {
  await page.goto(UNREGISTERED_SITE);
  await expectSignInScreen(page);
  await page.getByLabel('Email').fill(allowedEmail('unregistered'));
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(loaderState(page)).toHaveAttribute('data-state', 'failed');
  await expect(page.getByRole('status')).toContainText("This site's address is not registered");

  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Continue with Google' }).click()]);
  await expect(popup.getByText('is not registered for this project')).toBeVisible();
  expect(await storedKey(page)).toBeNull();
});

test('what the service says about the sign-in page applies without a rebuild', async ({ page }) => {
  try {
    await mock({ methods: ['email'], heading: 'Acme staff only', message: 'Use your work address.' });
    await page.goto(SITE);
    await expect(loaderState(page)).toHaveAttribute('data-state', 'signed-out');
    await expect(page.getByRole('heading', { name: 'Acme staff only' })).toBeVisible();
    await expect(page).toHaveTitle('Acme staff only');
    await expect(page.getByRole('status')).toHaveText('Use your work address.');
    await expect(page.getByRole('button', { name: 'Email me a code' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeHidden();
  } finally {
    await mock({ methods: ['google', 'email'], heading: null, message: null });
  }
});

test('a service that cannot be reached says so, and Retry recovers', async ({ page }) => {
  await page.route(`${SERVICE}/v1/projects/*/sign-in`, (route) => route.abort('connectionrefused'));
  await page.goto(SITE);
  await expect(loaderState(page)).toHaveAttribute('data-state', 'unreachable');
  await expect(page.getByRole('status')).toHaveText('The sign-in service cannot be reached right now. Try again in a moment.');
  await page.unroute(`${SERVICE}/v1/projects/*/sign-in`);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expectSignInScreen(page);
});

test('a site encrypted with the CLI: translated sign-in page, plain pages, no single-page fallback', async ({ page }) => {
  const email = allowedEmail('cli');
  await page.goto(CLI_SITE);
  await expect(loaderState(page)).toHaveAttribute('data-state', 'signed-out');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page).toHaveTitle(GERMAN.title);
  await expect(page.getByRole('heading', { name: GERMAN.title })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Anmelden bei Team handbook');
  // Sentences that were not replaced stay English.
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  expect(await page.content()).not.toContain(CLI_MARKER);

  await askForCode(page, email, { email: GERMAN.emailLabel, send: GERMAN.sendCode });
  await expect(page.getByRole('status')).toHaveText(`Falls ${email} Zugriff hat, ist ein Code unterwegs.`);
  const code = await emailCode(email);
  await enterCode(page, code === '000000' ? '111111' : '000000', GERMAN.submitCode);
  await expect(page.getByRole('status')).toHaveText(GERMAN.wrongCode);
  await enterCode(page, code, GERMAN.submitCode);
  await expect(page.getByRole('heading', { name: `Start ${CLI_MARKER}` })).toBeVisible();

  // Pages resolve the way static hosts resolve them: "about" is about.html, "docs/" is docs/index.html.
  await page.getByRole('link', { name: 'About' }).click();
  await expect(page.getByRole('heading', { name: `About ${CLI_MARKER}` })).toBeVisible();
  await page.goto(`${CLI_SITE}docs`);
  await expect(page.getByRole('heading', { name: `Docs ${CLI_MARKER}` })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/docs/');
  // A passthrough file is the host's own copy, and an unknown path is the host's 404, not the start page.
  expect(await (await page.request.get(`${CLI_SITE}robots.txt`)).text()).toContain('Disallow: /');
  const missing = await page.goto(`${CLI_SITE}nothing-here`);
  expect(missing!.status()).toBe(404);
  await expect(page.getByRole('heading', { name: `Start ${CLI_MARKER}` })).toBeHidden();
});

// Last: it replaces the build the other tests use.
test('a new build has a new key, so everyone signs in again', async ({ page }) => {
  await page.goto(SITE);
  await signInWithCode(page, allowedEmail('before'));
  await expectApp(page);
  const before = await manifest(page, SITE);

  await buildDemo({ serviceUrl: SERVICE, projectId: PROJECT.id, deployToken: PROJECT.deployToken, outDir: OUT_DIR, demoApiUrl: DEMO_API });
  const after = await manifest(page, SITE);
  expect(after.keyId).not.toBe(before.keyId);

  await page.reload();
  await expectSignInScreen(page);
  expect(await page.content()).not.toContain(MARKER);
  await signInWithCode(page, allowedEmail('after'));
  await expectApp(page);
  expect(await storedKey(page)).toMatchObject({ keyId: after.keyId });
});
