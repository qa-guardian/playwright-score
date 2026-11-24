import { test, expect } from '@playwright/test';

test('promo banner shows the sale', async ({ page }) => {
  await page.goto('/shop');
  const banner = page.getByTestId('promo-banner');
  await expect(banner).not.toBeVisible().catch((error) => {
    console.log('banner was already open');
    throw error;
  });
  await expect(banner).toHaveText('Winter sale');
});
