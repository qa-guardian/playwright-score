const { test, expect } = require('@playwright/test');

const pending = [];

test('alert appears', async ({ page }) => {
  await page.goto('/alerts');
  pending.push(expect(page.getByRole('alert')));
  await pending[0].toBeVisible();
});
