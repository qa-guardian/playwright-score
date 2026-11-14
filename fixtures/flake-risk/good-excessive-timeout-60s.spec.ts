import { test, expect } from '@playwright/test';

test('a round one-minute wait is the common idiom, not flagged', async ({ page }) => {
  await page.goto('https://example.com/oauth', { timeout: 60_000 });
  await expect(page.getByText('Done')).toBeVisible({ timeout: 60 * 1000 });
});
