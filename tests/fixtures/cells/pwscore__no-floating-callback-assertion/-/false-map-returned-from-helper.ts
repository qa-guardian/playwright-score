import { test, expect, type Page } from '@playwright/test';

function checkNames(page: Page, names: string[]) {
  return names.map(async (name) => {
    await expect(page.getByText(name)).toBeVisible();
  });
}

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await Promise.all(checkNames(page, ['Tea', 'Milk']));
});
