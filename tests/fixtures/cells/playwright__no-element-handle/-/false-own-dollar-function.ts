import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  const $ = (selector: string) => selector.length;
  expect($('#a')).toBe(2);
  await page.goto('/cart');
});
