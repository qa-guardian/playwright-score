const { test } = require('@playwright/test');

test('opens the pricing page', async ({ page }) => {
  await page.goto('/pricing');
  await page.getByRole('link', { name: 'Compare plans' }).click();
});
