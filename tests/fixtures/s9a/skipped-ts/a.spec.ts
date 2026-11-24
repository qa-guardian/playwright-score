import { test, expect } from '@playwright/test';

test.skip('exports the ledger', async ({ page }) => {
  await page.goto('/ledger');
  await page.waitForSelector('#ledger');
});

test('imports a ledger', async ({ page }) => {
  test.skip();
  await page.goto('/ledger/import');
  await page.waitForSelector('#import');
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
