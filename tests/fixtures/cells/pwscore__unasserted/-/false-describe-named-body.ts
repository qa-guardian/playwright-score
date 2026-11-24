import { test, expect } from '@playwright/test';

function orderTests() {
  test('lists the orders', async ({ page }) => {
    await page.goto('/orders');
    await expect(page.getByRole('row')).toHaveCount(4);
  });
}

test.describe('orders', orderTests);
