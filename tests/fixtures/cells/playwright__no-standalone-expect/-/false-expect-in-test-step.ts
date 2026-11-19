import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await test.step('open', async () => {
    await page.goto('/cart');
    await expect(page.getByRole('heading')).toBeVisible();
  });
});
