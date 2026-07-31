import { test, expect } from '@playwright/test';

test.describe('Flaky waits', () => {
  test('uses hard waits', async ({ page }) => {
    await page.goto('/app');
    await page.waitForTimeout(5000);
    await page.locator('.btn-primary').click({ force: true });
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.done')).toBeVisible();
  });
});
