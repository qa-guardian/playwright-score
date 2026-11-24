import { test, expect } from '@playwright/test';

const stepThrough = process.env.STEP_THROUGH === '1';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  stepThrough ? await page.pause() : undefined;
  await expect(page.getByRole('heading')).toBeVisible();
});
