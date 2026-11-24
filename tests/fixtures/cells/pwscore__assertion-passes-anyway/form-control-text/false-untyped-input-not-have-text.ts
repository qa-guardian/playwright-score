import { test, expect } from '@playwright/test';

test('query is not kept', async ({ page }) => {
  await page.goto('/search');
  await page.locator('input[name=q]').fill('desk');
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.locator('input[name=q]')).not.toHaveText('desk');
});
