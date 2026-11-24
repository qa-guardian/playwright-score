import { test, expect } from '@playwright/test';

const settle = { waitUntil: 'networkidle' as const };
const navigation = settle;

test('orders page', async ({ page }) => {
  await page.goto('/orders', navigation);
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
});
