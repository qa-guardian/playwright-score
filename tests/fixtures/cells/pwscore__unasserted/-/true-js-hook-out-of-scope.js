const { test, expect } = require('@playwright/test');

test.describe('dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('opens the settings panel', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
  });
});

test('opens the help page', async ({ page }) => {
  // The hook above belongs to the describe block: its assertion does not cover this test.
  await page.goto('/help');
});
