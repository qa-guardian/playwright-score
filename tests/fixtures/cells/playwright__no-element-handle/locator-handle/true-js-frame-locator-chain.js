const { test, expect } = require('@playwright/test');

test('card number field', async ({ page }) => {
  await page.goto('/checkout');
  const field = await page.frameLocator('#payment-frame').locator('input[name="card-number"]').elementHandle();
  await field.fill('4242424242424242');
});
