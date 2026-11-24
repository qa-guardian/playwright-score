const { test, expect } = require('@playwright/test');

test('cover image', async ({ page }) => {
  await page.goto('/gallery');
  await page.getByRole('button', { name: 'Next' }).click();
  expect(await page.getByRole('img', { name: 'Cover' }).getAttribute('src')).toBe('/covers/2.png');
});
