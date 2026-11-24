import { test, expect } from '@playwright/test';
import { refreshOrders } from './true-helpers.js';

test('orders page', async ({ page }) => {
  await page.goto('/orders');
  await refreshOrders(page);
  await expect(page).toHaveURL('/orders');
});
