import { test, expect } from '@playwright/test';

const idle = 'networkidle';
const state = idle;

test('orders page', async ({ page }) => {
  await page.goto('/orders');
  await page.waitForLoadState(state);
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
});
