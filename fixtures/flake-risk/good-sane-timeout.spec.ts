import { test, expect } from '@playwright/test';

test.setTimeout(120_000);

test.describe('slow only when asked', () => {
  test.slow(process.env.CI === '1', 'CI is slow');

  test('bounded waits', async ({ page }) => {
    await page.goto('https://example.com', { timeout: 30_000 });
    await expect(page.getByText('Done')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText('Report')).toBeVisible({ timeout: 59_999 });
  });
});
