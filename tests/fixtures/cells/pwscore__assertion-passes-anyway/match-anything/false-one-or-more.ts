import { test, expect } from '@playwright/test';

test('lands somewhere', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page).toHaveURL(/.+/);
  await expect(page.getByRole('heading')).toHaveText(/.+/);
});
