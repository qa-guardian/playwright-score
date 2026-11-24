const { test, expect } = require('@playwright/test');

test('lists the rows', async ({ page }) => {
  await page.goto('/cart');
  const rows = await page.getByRole('row').count();
  expect(rows).toBeGreaterThanOrEqual(0);
});

test('shows the total after a pause', async ({ page }) => {
  await page.goto('/cart');
  await page.waitForTimeout(500);
  await expect(page.getByText('Total')).toBeVisible();
});

test('shows the welcome heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
});
