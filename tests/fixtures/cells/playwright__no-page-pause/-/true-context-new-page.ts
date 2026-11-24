import { test, expect } from '@playwright/test';

test('second tab', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('/settings');
  await page.pause();
  await expect(page.getByRole('heading')).toBeVisible();
});
