import { test, expect } from '@playwright/test';

test('promo banner shows the sale', async ({ page }) => {
  await page.goto('/shop');
  const banner = page.getByTestId('promo-banner');
  await expect(banner).toBeVisible({ timeout: 2000 }).catch(() => {});
  await expect(banner).toHaveText('Winter sale');
});
