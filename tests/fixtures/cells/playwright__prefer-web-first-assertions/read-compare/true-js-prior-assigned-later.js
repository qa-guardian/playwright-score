const { test, expect } = require('@playwright/test');

test('feed refresh', async ({ page }) => {
  let prior;
  await page.goto('/feed');
  prior = await page.getByTestId('latest').innerText();
  await page.getByRole('button', { name: 'Refresh' }).click();
  expect(await page.getByTestId('latest').innerText()).not.toBe(prior);
});
