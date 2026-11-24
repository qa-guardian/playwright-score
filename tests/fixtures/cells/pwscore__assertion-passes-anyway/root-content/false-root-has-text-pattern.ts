import { test, expect } from '@playwright/test';

test('order is confirmed', async ({ page }) => {
  await page.goto('/orders/last');
  await expect(page.locator('body')).toHaveText(/Order #\d+ confirmed/);
});
