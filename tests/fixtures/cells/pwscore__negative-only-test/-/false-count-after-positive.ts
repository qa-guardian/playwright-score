import { test, expect } from '@playwright/test';

test('archiving the drafts removes all three', async ({ page }) => {
  const drafts = page.getByRole('row').filter({ hasText: 'Draft' });
  await page.goto('/notebook');
  await expect(drafts).toHaveCount(3);
  await page.getByRole('button', { name: 'Archive drafts' }).click();
  await expect(drafts).toHaveCount(0);
});
