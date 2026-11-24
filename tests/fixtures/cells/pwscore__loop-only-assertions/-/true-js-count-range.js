const { test, expect } = require('@playwright/test');

test('every invoice row shows a total', async ({ page }) => {
  await page.goto('/billing/invoices');
  const rows = page.getByRole('row');
  const total = await rows.count();
  for (let i = 0; i < total; i++) {
    await expect(rows.nth(i)).toContainText('EUR');
  }
});
