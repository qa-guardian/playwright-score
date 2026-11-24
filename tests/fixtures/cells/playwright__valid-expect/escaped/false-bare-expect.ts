import { test, expect } from '@playwright/test';

test('alert appears', async ({ page }) => {
  await page.goto('/alerts');
  expect(page.getByRole('alert'));
});
