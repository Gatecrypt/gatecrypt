import { defineConfig, devices } from '@playwright/test';

// BROWSERS=chromium,firefox,webkit runs all three; the default is Chromium only.
const browsers = (process.env.BROWSERS ?? 'chromium').split(',');

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  // One mock service is shared, and some tests change its project.
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  // Building every framework takes a while the first time.
  globalTimeout: 20 * 60_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ].filter((project) => browsers.includes(project.name)),
});
