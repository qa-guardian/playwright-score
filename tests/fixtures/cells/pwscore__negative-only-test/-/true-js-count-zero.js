const { test, expect } = require('@playwright/test');

test('clearing the basket empties the list', async ({ page }) => {
  await page.goto('/basket');
  await page.getByRole('button', { name: 'Clear basket' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(0);
});
