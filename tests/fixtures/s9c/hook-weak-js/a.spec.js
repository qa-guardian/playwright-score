const { test, expect } = require('@playwright/test');

test.describe('cart', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/cart');
    const rows = await page.getByRole('row').count();
    expect(rows).toBeGreaterThanOrEqual(0);
  });

  test('shows the total', async ({ page }) => {
    await expect(page.getByText('Total')).toBeVisible();
  });

  test('shows the checkout button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Checkout' })).toBeVisible();
  });
});

test('shows the welcome heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
});
