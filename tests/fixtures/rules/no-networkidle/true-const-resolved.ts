import { test, expect } from '@playwright/test';

const IDLE = 'networkidle';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await page.waitForLoadState(IDLE);
  await expect(page.getByRole('heading')).toBeVisible();
});
