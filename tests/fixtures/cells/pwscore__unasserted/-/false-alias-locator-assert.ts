import { test, expect } from '@playwright/test';

test('confirms the order', async ({ page }) => {
  const banner = page.getByRole('status');
  await page.goto('/checkout');
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(banner).toHaveText('Order placed');
});
