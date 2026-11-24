import { test, expect } from '@playwright/test';

test('badge shows the count', async ({ page }) => {
  await page.goto('/inbox');
  const unread = await page.getByRole('row', { name: /unread/ }).count();
  await expect(page.getByTestId('unread-badge')).toContainText(String(unread));
});
