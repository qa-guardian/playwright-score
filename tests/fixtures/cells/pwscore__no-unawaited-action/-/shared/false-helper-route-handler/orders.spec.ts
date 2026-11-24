import { test, expect } from '@playwright/test';
import { stubOrders } from './false-helpers';

test('orders page', async ({ page }) => {
  await page.goto('/orders');
  await stubOrders(page);
  await expect(page).toHaveURL('/orders');
});
