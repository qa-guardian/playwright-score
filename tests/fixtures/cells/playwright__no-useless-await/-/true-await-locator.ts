import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const heading = await page.getByRole('heading');
  await expect(heading).toBeVisible();
});
