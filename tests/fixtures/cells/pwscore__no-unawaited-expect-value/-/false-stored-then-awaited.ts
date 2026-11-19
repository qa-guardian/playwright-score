import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const shown = page.getByRole('heading').isVisible();
  expect(await shown).toBe(true);
});
