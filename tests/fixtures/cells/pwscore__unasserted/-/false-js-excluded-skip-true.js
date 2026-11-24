const { test } = require('@playwright/test');

test('exports the legacy report', async ({ page }) => {
  test.skip(true, 'The legacy export is retired');
  await page.goto('/reports/legacy');
});
