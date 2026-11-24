import assert from 'node:assert';
import { test } from '@playwright/test';

test('shows the invoices title', async ({ page }) => {
  await page.goto('/invoices');
  assert.equal(await page.title(), 'Invoices');
});
