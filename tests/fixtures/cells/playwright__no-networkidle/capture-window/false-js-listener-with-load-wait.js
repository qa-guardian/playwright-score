const { test, expect } = require('@playwright/test');

test('dashboard requests', async ({ page }) => {
  const statuses = [];
  page.on('response', (response) => statuses.push(response.status()));
  await page.goto('/dashboard');
  await page.waitForLoadState('load');
  expect(statuses).not.toContain(500);
});
