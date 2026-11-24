import { test, expect } from '@playwright/test';

test('checkout button shows', async ({ page }) => {
  await page.goto('/cart');
  await page.getByRole('button', { name: 'Checkout' }).isVisible();
});
