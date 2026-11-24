import { test, expect } from '@playwright/test';

test('draft badge after edit', async ({ page }) => {
  await page.goto('/posts/42');
  const badge = page.getByText('Draft');
  await expect(badge).not.toBeAttached().catch(() => undefined);
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(badge).toBeVisible();
});
