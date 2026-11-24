import { test, expect } from '@playwright/test';

test('address field starts empty', async ({ page }) => {
  await page.goto('/newsletter');
  await expect(page.getByPlaceholder('name@example.com')).toHaveText('');
});
