const { test, expect } = require('@playwright/test');

async function audit(check) {
  await check;
}

test('settings are saved', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Save' }).click();
  return audit(expect(page.getByText('Saved')).toBeVisible());
});
