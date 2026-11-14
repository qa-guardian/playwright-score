import { test, expect } from '@playwright/test';

test.describe.serial('checkout flow', () => {
  let id: string;
  test('creates', async ({ page }) => {
    await page.goto('https://example.com/new');
    id = await page.getByTestId('id').innerText();
  });
  test('uses it', async ({ page }) => {
    await page.goto(`https://example.com/items/${id}`);
    await expect(page.getByTestId('title')).toBeVisible();
  });
});
