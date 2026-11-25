import { test, expect } from '@playwright/test';

test('dismissing the cookie banner hides it', async ({ page }) => {
  await page.goto('/pantry');
  await page.getByRole('button', { name: 'Accept cookies' }).click();
  await expect(page.getByRole('region', { name: 'Cookie notice' })).not.toBeVisible();
});
