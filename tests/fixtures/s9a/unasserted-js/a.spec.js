const { test, expect } = require('@playwright/test');

test('opens the pricing page', async ({ page }) => {
  await page.goto('/pricing');
  await page.getByRole('link', { name: 'Compare plans' }).click();
});

test('shows the welcome heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
});
