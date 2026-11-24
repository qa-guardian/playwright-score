import { test, expect } from '@playwright/test';

function noop() {}

test('spinner gone before the table loads', async ({ page }) => {
  await page.goto('/reports');
  const spinner = page.getByRole('progressbar');
  await expect(spinner).not.toBeVisible().catch(noop);
  await expect(spinner).toHaveCount(0);
});
