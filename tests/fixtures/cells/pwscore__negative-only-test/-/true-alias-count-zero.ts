import { test, expect } from '@playwright/test';

test('archiving every draft leaves none', async ({ page }) => {
  const drafts = page.getByRole('row').filter({ hasText: 'Draft' });
  await page.goto('/notebook');
  await page.getByRole('button', { name: 'Archive drafts' }).click();
  await expect(drafts).toHaveCount(0);
});
