import { test, expect } from '@playwright/test';

test.fixme('checkout totals update', async ({ page }) => {
  await page.goto('/cart');
  await expect(page.getByTestId('total')).toHaveText('$10');
});

test('profile page', async ({ page }) => {
  test.fixme();
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
});
