import { test, expect } from '@playwright/test';

const navigation = { waitUntil: 'networkidle0' };

test('orders page', async ({ page }) => {
  await page.goto('/orders', navigation);
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
});
