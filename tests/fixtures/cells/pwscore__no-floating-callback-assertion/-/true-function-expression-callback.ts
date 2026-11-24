import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const names = ['Tea', 'Milk'];
  names.forEach(async function (name) {
    await expect(page.getByText(name)).not.toBeHidden();
  });
});
