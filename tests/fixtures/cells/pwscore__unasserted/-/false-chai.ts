import { assert } from 'chai';
import { test } from '@playwright/test';

test('shows the invoices title', async ({ page }) => {
  await page.goto('/invoices');
  assert.strictEqual(await page.title(), 'Invoices');
});
