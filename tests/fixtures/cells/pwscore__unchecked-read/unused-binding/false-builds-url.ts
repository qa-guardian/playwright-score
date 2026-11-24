import { test, expect } from '@playwright/test';

test('opens the first order', async ({ page }) => {
  await page.goto('/orders');
  const id = await page.getByTestId('order-row').first().getAttribute('data-order-id');
  await page.goto(`/orders/${id}`);
  await expect(page.getByRole('heading', { name: 'Order details' })).toBeVisible();
});
