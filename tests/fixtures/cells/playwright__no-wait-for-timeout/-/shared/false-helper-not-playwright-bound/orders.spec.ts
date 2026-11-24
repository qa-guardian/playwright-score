import { test, expect } from '@playwright/test';
import { settle } from './false-clock';

test('orders page', async ({ page }) => {
  await page.goto('/orders');
  await settle();
  await expect(page).toHaveURL('/orders');
});
