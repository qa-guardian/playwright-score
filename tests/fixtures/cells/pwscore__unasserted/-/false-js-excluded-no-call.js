const { test } = require('@playwright/test');

test('drafts the refund flow', async ({ page }) => {
  // No call in the callback: excluded like an empty test.
  const plan = { amount: 20, currency: 'EUR' };
});
