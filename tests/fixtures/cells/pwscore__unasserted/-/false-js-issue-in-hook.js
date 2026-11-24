const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  page.getByRole('link', { name: 'Profile' }).click();
});

test('shows the avatar', async ({ page }) => {
  await expect(page.getByRole('img', { name: 'Avatar' })).toBeVisible();
});
