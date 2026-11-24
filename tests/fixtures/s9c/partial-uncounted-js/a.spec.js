const { test, expect } = require('@playwright/test');

test('is cut off', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading').toBeVisible(;
