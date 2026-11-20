import { test, expect } from '@playwright/test';

test('orders list', async ({ page }) => {
  await page.goto('/orders');
  const names = await page.getByRole('listitem').allTextContents();
  console.log(names.length);
  expect(names).toEqual(['First', 'Second']);
});
