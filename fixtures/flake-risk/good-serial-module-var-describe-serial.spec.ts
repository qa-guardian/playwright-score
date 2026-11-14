import { test, expect } from '@playwright/test';

let orderId = '';

test.describe.serial('order', () => {
  test('creates', async ({ page }) => {
    await page.goto('https://example.com/new');
    orderId = await page.getByTestId('id').innerText();
  });
  test('reads', async ({ page }) => {
    await page.goto(`https://example.com/o/${orderId}`);
    await expect(page.getByTestId('title')).toBeVisible();
  });
});
