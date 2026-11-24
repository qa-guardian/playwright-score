import { test, expect } from '@playwright/test';

test('email field is not blank', async ({ page }) => {
  await page.goto('/newsletter');
  await page.locator('input[type=email]').fill('reader@example.com');
  await expect(page.locator('input[type=email]')).not.toHaveText('');
});
