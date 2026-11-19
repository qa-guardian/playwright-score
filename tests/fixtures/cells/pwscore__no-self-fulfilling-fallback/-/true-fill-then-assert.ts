import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const coupon = page.getByLabel('Coupon');
  if (!(await coupon.isVisible())) {
    await page.getByLabel('Coupon').fill('SAVE10');
  }
  await expect(coupon).toHaveValue('SAVE10');
});
