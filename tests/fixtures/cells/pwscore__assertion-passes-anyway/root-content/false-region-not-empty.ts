import { test, expect } from '@playwright/test';

test('order summary is filled', async ({ page }) => {
  await page.goto('/checkout');
  await expect(page.locator('#order-summary')).not.toBeEmpty();
});
