import { test, expect } from '@playwright/test';

test('total row shows the sum', async ({ page }) => {
  await page.goto('/cart');
  const row = await page.$('tr.total');
  const text = await row.$eval('td', (cell) => cell.textContent);
  expect(text).toBe('40.00');
});
