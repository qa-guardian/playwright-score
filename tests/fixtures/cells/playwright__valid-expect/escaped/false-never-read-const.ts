import { test, expect } from '@playwright/test';

test('banner', async ({ page }) => {
  const banner = expect(page.getByRole('banner'));
  await page.goto('/');
});
