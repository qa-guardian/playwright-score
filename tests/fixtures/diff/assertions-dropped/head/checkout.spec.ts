import { test, expect } from '@playwright/test';

test('pays for the order', async ({ page }) => {
  await page.goto('/checkout');
  await page.getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible();
});

test('keeps the cart on reload', async ({ page }) => {
  await page.goto('/checkout');
  await page.reload();
  await expect(page.getByTestId('total')).toHaveText('$20.00');
});
