const { test, expect } = require('@playwright/test');

test.fixme('imports a ledger', async ({ page }) => {
  await page.goto('/ledger/import');
  await expect(page.getByLabel('File')).toBeVisible();
});
