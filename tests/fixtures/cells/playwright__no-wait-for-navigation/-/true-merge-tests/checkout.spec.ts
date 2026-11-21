import { expect } from '@playwright/test';
import { test } from './fixtures';

test('checkout redirects', async ({ page }) => {
  await page.goto('/checkout');
  await Promise.all([page.waitForNavigation(), page.getByRole('button', { name: 'Pay' }).click()]);
  await expect(page).toHaveURL(/receipt/);
});
