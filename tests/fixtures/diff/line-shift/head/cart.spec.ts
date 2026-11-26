import { test, expect } from '@playwright/test';

// A comment block added above the test moves it down the file.
// It changes no behaviour and must not make the old finding new.
const CART_URL = '/cart';

test('removes an item', async ({ page }) => {
  await page.goto(CART_URL);
  page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Your cart is empty')).toBeVisible();
});
