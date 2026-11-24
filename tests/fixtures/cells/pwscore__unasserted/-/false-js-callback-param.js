const { test } = require('@playwright/test');

test('shows an empty plan list', async ({ page }) => {
  // A method called on a callback parameter is not resolved (it is not a Playwright name).
  await page.route('**/api/plans', (route) => route.fulfill({ json: [] }));
  await page.goto('/plans');
});
