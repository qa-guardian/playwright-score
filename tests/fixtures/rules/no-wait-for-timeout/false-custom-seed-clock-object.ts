import { test, expect } from '@playwright/test';

const seedClock = { waitForTimeout: (ms: number) => ms };

test('cart page', async ({ page }) => {
  seedClock.waitForTimeout(500);
  await page.goto('/cart');
  await expect(page.getByRole('heading')).toBeVisible();
});
