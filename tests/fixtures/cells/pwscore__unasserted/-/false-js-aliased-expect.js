const { test, expect } = require('@playwright/test');

const check = expect;

test('shows the welcome banner', async ({ page }) => {
  await page.goto('/home');
  // A const alias of expect is bound by a later slice (S4b.2). Until then the callee is not resolved:
  // the test is unverified and never unasserted. Once the alias is bound it can only become clean or issue.
  await check(page.getByRole('banner')).toBeVisible();
});
