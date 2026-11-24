import { test, expect } from '@playwright/test';

test('banner is shown', async ({ page }) => {
  await page.goto('/home');
  expect(page.getByRole('banner')).toBeVisible();
});
