const { test, expect } = require('@playwright/test');

const it = test.extend({
  settled: async ({ page }, use) => {
    await page.waitForSelector('#app');
    await use(page);
  },
});

test.describe('settings', () => {
  const ready = async (page) => {
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

module.exports = { it };
