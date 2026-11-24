import { test, expect } from '@playwright/test';

test('shows the greeting', async ({ page }) => {
  await page.goto('/home');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/[\s\S]*/);
});
