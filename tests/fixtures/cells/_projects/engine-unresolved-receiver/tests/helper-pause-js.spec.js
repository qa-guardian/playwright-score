const { test, expect } = require('@playwright/test');

async function debugStop(page) {
  await page.pause();
}

test('report page from a script file', async ({ page }) => {
  await page.goto('/reports');
  await debugStop(page);
  await expect(page.getByRole('heading')).toBeVisible();
});
