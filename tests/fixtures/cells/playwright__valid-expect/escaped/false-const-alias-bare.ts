import { test, expect } from '@playwright/test';

const check = expect;

test('alert appears', async ({ page }) => {
  await page.goto('/alerts');
  check(page.getByRole('alert'));
});
