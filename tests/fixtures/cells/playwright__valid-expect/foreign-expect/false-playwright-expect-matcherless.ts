import { test, expect } from '@playwright/test';

test('invoice list has a title', async ({ page }) => {
  await page.goto('/invoices');
  expect(page.getByRole('heading', { name: 'Invoices' }));
});
