import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  void page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('heading')).toBeVisible();
});
