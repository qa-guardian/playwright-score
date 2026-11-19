import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  const player = { pause: async () => undefined };
  await page.goto('/cart');
  await player.pause();
  await expect(page.getByRole('heading')).toBeVisible();
});
