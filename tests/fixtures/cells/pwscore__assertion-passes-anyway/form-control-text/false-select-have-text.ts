import { test, expect } from '@playwright/test';

test('country list has no options yet', async ({ page }) => {
  await page.goto('/checkout/address');
  await expect(page.locator('select[name=country]')).toHaveText('');
});
