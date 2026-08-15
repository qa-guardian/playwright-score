import { test, expect } from '@playwright/test';

test.describe.serial('checkout journey', () => {
  test('add to cart', async ({ page }) => {
    await test.step('Add item', async () => {
      await page.goto('/cart');
      await expect(page.getByText('Cart')).toBeVisible();
    });
  });

  test('checkout', async ({ page }) => {
    await test.step('Complete checkout', async () => {
      await page.goto('/checkout');
      await expect(page.getByText('Checkout')).toBeVisible();
    });
  });
});
