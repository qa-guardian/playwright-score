import { test } from '@playwright/test';

test.skip('downloads the invoice', async ({ page }) => {
  await page.goto('/invoices');
});

test.describe.skip('legacy checkout', () => {
  test('pays by cheque', async ({ page }) => {
    await page.goto('/legacy');
  });
});

test('prints the label', async ({ page }) => {
  test.fixme();
  await page.goto('/labels');
});
