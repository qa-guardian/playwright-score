import { test, expect } from '@playwright/test';

test('newsletter field is cleared', async ({ page }) => {
  await page.goto('/newsletter');
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('input[type=email]')).toHaveValue('');
});
