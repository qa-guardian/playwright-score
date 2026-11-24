import { test, expect } from '@playwright/test';
import { openOrders } from './false-helpers';

test('orders page', async ({ page }) => {
  await page.goto('/orders');
  await openOrders(page);
  await expect(page).toHaveURL('/orders');
});
