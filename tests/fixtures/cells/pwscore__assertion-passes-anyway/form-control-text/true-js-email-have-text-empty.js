import { test, expect } from '@playwright/test';

test('contact field is cleared', async ({ page }) => {
  await page.goto('/contact');
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('input[type=email][name=reply-to]')).toHaveText('');
});
