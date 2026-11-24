const { test, expect } = require('@playwright/test');

test('dashboard console', async ({ page }) => {
  const warnings = [];
  page.on('console', (msg) => {
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle');
  expect(warnings).toEqual([]);
});
