import { test, expect } from '@playwright/test';

const clock = {
  async waitForTimeout(ms: number) {
    return ms;
  },
};

test('invoice totals', async ({ page }) => {
  await page.goto('/invoices');
  await clock.waitForTimeout(500);
  await expect(page.getByText('Total: 42.00')).toBeVisible();
});
