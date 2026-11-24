import { test, expect } from '@playwright/test';

test('heading', async ({ page }) => {
  await page.goto('/');
  const { heading } = { heading: page.getByRole('heading') };
  expect(heading).toBeTruthy();
  await expect(heading).toBeVisible();
});
