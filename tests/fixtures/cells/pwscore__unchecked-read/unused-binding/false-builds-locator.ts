import { test, expect } from '@playwright/test';

test('finds the product by its sku', async ({ page }) => {
  await page.goto('/catalog');
  const sku = await page.getByTestId('featured-product').getAttribute('data-sku');
  await expect(page.locator(`[data-sku="${sku}"]`)).toHaveCount(1);
});
