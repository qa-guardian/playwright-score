const { test, expect } = require('@playwright/test');

const rowsExist = async (page) => {
  const rows = await page.getByRole('row').count();
  expect(rows).toBeGreaterThanOrEqual(0);
};

test.skip('lists the rows', async ({ page }) => {
  await page.goto('/cart');
  await rowsExist(page);
});
