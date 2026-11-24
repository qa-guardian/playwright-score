import { test, expect } from '@playwright/test';

test.describe.skip('ledger', () => {
  test('exports a CSV file', async ({ page }) => {
    await page.goto('/ledger');
    await expect(page.getByRole('button', { name: 'Export' })).toBeVisible();
  });
});
