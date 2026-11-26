import { test, expect } from '@playwright/test';

test.describe('search', () => {
  test('finds a product', async ({ page }) => {
    await page.goto('/search');
    await page.getByRole('searchbox').fill('shoes');
    await expect(page.getByRole('listitem')).toHaveCount(3);
  });
});
