import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await page.locator('video').evaluate((video: HTMLVideoElement) => video.pause());
  await expect(page.getByRole('heading')).toBeVisible();
});
