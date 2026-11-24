import { test, expect } from '@playwright/test';

test('order button has no label', async ({ page }) => {
  await page.goto('/cart');
  await expect(page.locator('input[type=submit]')).toHaveText('');
});
