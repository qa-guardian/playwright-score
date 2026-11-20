import { test, expect } from '@playwright/test';

test('orders banner', async ({ page }) => {
  await page.goto('/orders');
  const banner = page.getByRole('alert');
  const shown = await banner.isVisible();
  if (shown) {
    await page.getByRole('button', { name: 'Dismiss' }).click();
  }
  expect.soft(shown).toBe(true);
});
