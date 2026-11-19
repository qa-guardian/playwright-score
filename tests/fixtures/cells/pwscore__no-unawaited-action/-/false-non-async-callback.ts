import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  page.on('dialog', (dialog) => {
    dialog.accept();
  });
  await expect(page.getByRole('heading')).toBeVisible();
});
