const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('opens the settings panel', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click();
});
