import { test, expect } from '@playwright/test';

test('receipt frame renders', async ({ page }) => {
  await page.goto('/receipts/latest');
  const receipt = page.frameLocator('iframe[name="receipt"]');
  await expect(receipt.locator('body')).not.toBeEmpty();
});
