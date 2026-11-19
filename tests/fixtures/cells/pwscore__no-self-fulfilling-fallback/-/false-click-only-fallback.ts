import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const menu = page.getByRole('menu');
  if (!(await menu.isVisible())) {
    await page.getByRole('button', { name: 'Menu' }).click();
  }
  await expect(menu).toBeVisible();
});
