const assert = require('node:assert');
const { test } = require('@playwright/test');

test('shows the invoices title', async ({ page }) => {
  await page.goto('/invoices');
  assert.equal(await page.title(), 'Invoices');
});
