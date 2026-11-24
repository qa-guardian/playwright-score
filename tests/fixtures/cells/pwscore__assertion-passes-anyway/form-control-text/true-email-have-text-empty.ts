import { test, expect } from '@playwright/test';

test('newsletter field starts empty', async ({ page }) => {
  await page.goto('/newsletter');
  await page.locator('input[type=email]').fill('reader@example.com');
  await expect(page.locator('input[type=email]')).toHaveText('');
});
