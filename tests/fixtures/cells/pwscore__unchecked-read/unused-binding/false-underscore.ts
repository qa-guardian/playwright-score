import { test, expect } from '@playwright/test';

test('warms the list', async ({ page }) => {
  await page.goto('/inbox');
  const _count = await page.getByRole('listitem').count();
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
});
