import { test, expect } from '@playwright/test';

test('error is blank', async ({ page }) => {
  await page.goto('/sign-up');
  await expect(page.getByRole('alert')).toHaveText(/^$/);
});
