import { test, expect } from '@playwright/test';

test('saving shows a message', async ({ page }) => {
  await page.goto('/settings');
  const check = expect(page.getByText('Saved'));
  await page.getByRole('button', { name: 'Save' }).click();
  await check.toBeVisible();
});
