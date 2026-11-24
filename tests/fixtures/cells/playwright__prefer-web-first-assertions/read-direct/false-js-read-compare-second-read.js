const { test, expect } = require('@playwright/test');

test('profile name', async ({ page }) => {
  await page.goto('/profile');
  await page.getByLabel('Display name').fill('Rowan');
  await page.getByRole('button', { name: 'Save' }).click();
  expect(await page.getByTestId('header-name').textContent()).toBe(await page.getByTestId('card-name').textContent());
});
