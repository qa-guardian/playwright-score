import { test, expect } from '@playwright/test';

test('first field starts empty', async ({ page }) => {
  await page.goto('/apply');
  await expect(page.locator('input').first()).toHaveText('');
});
