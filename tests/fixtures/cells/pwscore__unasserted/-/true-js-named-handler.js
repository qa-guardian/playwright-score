const { test } = require('@playwright/test');

const opensOrders = async ({ page }) => {
  await page.goto('/orders');
  await page.getByRole('link', { name: 'Newest first' }).click();
};

test('opens the orders page', opensOrders);
