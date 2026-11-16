/**
 * Each framework's site, built as static files and encrypted, in a real
 * browser: it signs in, shows its pages, and calls its API, written in the
 * same framework, which names the visitor from the token alone.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { mockCode } from '../../../dev/visitor.mjs';
import { EXAMPLES_DIR, FRAMEWORKS, MARKER, SERVICE, url } from '../env.ts';

const uniqueEmail = (name: string): string => `${name}-${Math.random().toString(36).slice(2, 8)}@example.org`;

async function signIn(page: Page, email: string): Promise<void> {
  await expect(page.locator('body')).toHaveAttribute('data-state', 'signed-out');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'code');
  await page.getByLabel('Code').fill(await mockCode(SERVICE, email));
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
}

for (const { name, title, site, api } of FRAMEWORKS) {
  test.describe(title, () => {
    const SITE = `${url(site.port)}/`;

    test('what gets deployed is ciphertext', async () => {
      const dir = path.join(EXAMPLES_DIR, site.dir, site.out);
      const names: string[] = [];
      for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const full = path.join(entry.parentPath, entry.name);
        names.push(path.relative(dir, full).split(path.sep).join('/'));
        const content = await readFile(full);
        expect(content.includes(MARKER), `${names.at(-1)} contains plaintext`).toBe(false);
        // Where the API is, is the site's business too.
        expect(content.includes(url(api.port)), `${names.at(-1)} names the API`).toBe(false);
      }
      expect(names).toEqual(expect.arrayContaining(['index.html', 'gatecrypt.json', 'gatecrypt-sw.js']));
      expect(names.filter((file) => !/^gatecrypt\/[0-9a-f]{32}\.bin$/.test(file)).sort()).toEqual(
        expect.arrayContaining(['404.html', 'gatecrypt-sw.js', 'gatecrypt.json', 'index.html']),
      );
    });

    test('signs in, shows its pages, and its API knows who is asking', async ({ page, context }) => {
      const errors: string[] = [];
      context.on('weberror', (error) => errors.push(error.error().message));
      const email = uniqueEmail(name);

      await page.goto(SITE);
      expect(await page.content()).not.toContain(MARKER);
      await signIn(page, email);

      // The decrypted site.
      await expect(page.getByTestId('secret')).toContainText(MARKER);
      // Its API, in the same framework, was sent the visitor's token by the service worker.
      await expect(page.getByTestId('api-email')).toHaveText(email);

      // A second page, by link and then by reload.
      await page.getByRole('link', { name: 'About' }).click();
      await expect(page.getByTestId('about')).toContainText(MARKER);
      await page.reload();
      await expect(page.getByTestId('about')).toContainText(MARKER);
      expect(new URL(page.url()).pathname.replace(/\/$/, '')).toBe('/about');

      // Straight to the home page again: still signed in, and the API still knows. (Once the page
      // has settled: a browser reports a script it was still fetching when it left as an error.)
      await page.waitForLoadState('networkidle');
      await page.goto(SITE);
      await expect(page.getByTestId('api-email')).toHaveText(email);
      expect(errors).toEqual([]);
    });

    test('a visitor without the token is nobody to the API', async ({ page }) => {
      await page.goto(SITE);
      await expect(page.locator('body')).toHaveAttribute('data-state', 'signed-out');
      const status = await page.evaluate(async (me) => (await fetch(me)).status, `${url(api.port)}/api/me`);
      expect(status).toBe(401);
    });

    test('a first visit to a page other than the home page signs in and lands there', async ({ page }) => {
      await page.goto(`${SITE}about`);
      await signIn(page, uniqueEmail(`${name}-deep`));
      await expect(page.getByTestId('about')).toContainText(MARKER);
    });
  });
}
