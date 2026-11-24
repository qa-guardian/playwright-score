const { test, expect } = require('@playwright/test');

test('opens the editor', async ({ page }) => {
  await page.goto('/editor');
  await page.pause();
  await expect(page.getByRole('textbox')).toBeVisible();
});

test('shows the welcome heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
});
