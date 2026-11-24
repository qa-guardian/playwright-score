import { test, expect } from '@playwright/test';

async function showsOrders({ page }) {
  await page.goto('/orders');
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
}

const showsCart = async ({ page }) => {
  await page.goto('/cart');
  await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible();
};

test('shows the orders', showsOrders);
test('shows the cart', showsCart);
test.fixme('shows the wish list', showsCart);
