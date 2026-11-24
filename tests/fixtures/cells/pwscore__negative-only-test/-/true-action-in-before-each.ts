import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/pond');
  await page.getByRole('button', { name: 'Mute alerts' }).click();
});

test('muting hides the alert bar', async ({ page }) => {
  await expect.soft(page.getByRole('alert')).not.toBeVisible();
  await expect(page.getByText('3 new alerts')).toBeHidden();
});
