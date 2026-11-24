import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export const it = test.extend({
  settled: async ({ page }, use) => {
    await page.waitForSelector('#app');
    await use(page);
  },
});

test.describe('settings', () => {
  const ready = async (page: Page) => {
    await page.waitForSelector('#settings');
  };

  test('opens the settings', async ({ page }) => {
    await page.goto('/settings');
    await ready(page);
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });
});

test('shows the welcome heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
});
