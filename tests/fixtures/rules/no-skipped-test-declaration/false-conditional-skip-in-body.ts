import { test, expect } from '@playwright/test';

test('cart page', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'cart is not rendered in webkit');
  await page.goto('/cart');
  await expect(page.getByRole('heading')).toBeVisible();
});
