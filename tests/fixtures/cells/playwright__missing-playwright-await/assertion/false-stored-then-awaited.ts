import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const shown = expect(page.getByRole('heading')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await shown;
});
