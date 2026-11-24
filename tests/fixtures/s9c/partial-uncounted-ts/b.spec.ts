import { test, expect } from '@playwright/test';

test.skip('exports the ledger', async ({ page }) => {
  await page.goto('/ledger');
  await expect(page.getByRole('table')).toBeVisible();
});
