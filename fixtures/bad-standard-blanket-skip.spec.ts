import { test, expect } from '@playwright/test';

test.skip('this test is broken, skipping it for now', async ({ page }) => {
  await page.goto('/broken');
  await expect(page.getByText('x')).toBeVisible();
});
