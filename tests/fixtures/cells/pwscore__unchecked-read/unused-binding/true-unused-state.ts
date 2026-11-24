import { test, expect } from '@playwright/test';

test('pays the order', async ({ page }) => {
  await page.goto('/checkout');
  const enabled = await page.getByRole('button', { name: 'Pay now' }).isEnabled();
  await page.getByRole('button', { name: 'Pay now' }).click();
  await expect(page.getByText('Payment received')).toBeVisible();
});
