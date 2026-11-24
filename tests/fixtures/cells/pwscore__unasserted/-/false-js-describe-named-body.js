const { test, expect } = require('@playwright/test');

const orderTests = () => {
  test('lists the orders', async ({ page }) => {
    await page.goto('/orders');
    await expect(page.getByRole('row')).toHaveCount(4);
  });
};

test.describe('orders', orderTests);
