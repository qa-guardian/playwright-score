const { test, expect } = require('@playwright/test');

test('orders list', async ({ page }) => {
  await page.goto('/orders');
  const items = page.getByRole('listitem');
  const names = await items.allTextContents();
  console.log(names.length);
  expect(names).toEqual(['First', 'Second']);
});
