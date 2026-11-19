import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const banner = page.getByRole('alert');
  const shown = await banner.isVisible();
  if (shown) {
    await banner.getByRole('button', { name: 'Close' }).click();
  }
  expect(shown).toBe(true);
});
