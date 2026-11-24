const { test, expect } = require('@playwright/test');

test.fixme('archives the ledger', async ({ page }) => {
  await page.goto('/ledger');
  await page.waitForSelector('#archive');
});

test('shows the welcome heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
});

test('waits for the order list', async ({ page }) => {
  await page.goto('/orders');
  await page.waitForSelector('#orders');
  await expect(page.getByRole('list', { name: 'Orders' })).toBeVisible();
});
