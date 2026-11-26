import { test, expect } from '@playwright/test';

test('removes an item', async ({ page }) => {
  await page.goto('/cart');
  page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Your cart is empty')).toBeVisible();
});
