import { test, expect } from '@playwright/test';

test.slow();
test.setTimeout(10 * 60 * 1000);

test('very long waits', async ({ page }) => {
  await page.goto('https://example.com', { timeout: 120_000 });
  await page.getByRole('button').click({ timeout: 2 * 60 * 1000 });
  await expect(page.getByText('Done')).toBeVisible({ timeout: 90_000 });
});
