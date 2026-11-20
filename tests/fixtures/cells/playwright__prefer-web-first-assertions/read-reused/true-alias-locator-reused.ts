import { test, expect } from '@playwright/test';

test('orders page', async ({ page }) => {
  await page.goto('/orders');
  const banner = page.getByRole('alert');
  const shown = await banner.isVisible();
  console.log(shown);
  expect(shown).toBe(true);
});
