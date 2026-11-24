import { test, expect } from '@playwright/test';

test('crumbs name the product', async ({ page }) => {
  await page.goto('/products/88');
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  const name = await page.getByTestId('product-name').textContent();
  await expect(crumbs).toContainText(name || '');
});
