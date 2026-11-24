const { verifyAccessibility } = require('acme-a11y-checks');
const { test } = require('@playwright/test');

test('the landing page is accessible', async ({ page }) => {
  await page.goto('/');
  await verifyAccessibility(page);
});
