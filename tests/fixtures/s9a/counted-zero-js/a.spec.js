const { test, expect } = require('@playwright/test');

test.skip('exports the ledger', async ({ page }) => {
  await page.goto('/ledger');
  await page.waitForSelector('#ledger');
});

test('is still to be written', async () => {});
