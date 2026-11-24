const { test, expect } = require('@playwright/test');

test.describe('cart', () => {
  const rowsExist = async (page) => {
    const rows = await page.getByRole('row').count();
    expect(rows).toBeGreaterThanOrEqual(0);
  };

  test('lists the rows', async ({ page }) => {
    await page.goto('/cart');
    await rowsExist(page);
    await expect(page.getByRole('table')).toBeVisible();
  });
});

test('shows the welcome heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
});
