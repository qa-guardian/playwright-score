import { test, expect } from '@playwright/test';

test.describe('cart', () => {
  test('adds an item', async ({ page }) => {
    await page.goto('/shop');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');
  });

  test('removes an item', async ({ page }) => {
    await page.goto('/cart');
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Your cart is empty')).toBeVisible();
  });
});
