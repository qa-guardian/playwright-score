const { test, expect } = require('@playwright/test');

async function maybeStop(page) {
  if (process.env.STEP_THROUGH) await page.pause();
}

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await maybeStop(page);
  await expect(page.getByRole('heading')).toBeVisible();
});
