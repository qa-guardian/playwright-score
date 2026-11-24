import { test, expect } from '@playwright/test';

const state = 'networkidle';

test('orders page', async ({ page }) => {
  await page.goto('/orders');
  await page.waitForLoadState(state);
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
});
