import { test, expect } from '@playwright/test';

test('no error is shown', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('body')).not.toContainText('Something went wrong');
});
