import { test, expect } from '@playwright/test';

test('saving shows a message', async ({ page }) => {
  await page.goto('/settings');
  const checks = { saved: expect(page.getByText('Saved')) };
  await page.getByRole('button', { name: 'Save' }).click();
  await checks.saved.toBeVisible();
});
