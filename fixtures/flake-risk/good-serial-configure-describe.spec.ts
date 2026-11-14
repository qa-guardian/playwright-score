import { test, expect } from '@playwright/test';

test.describe('account', () => {
  test.describe.configure({ mode: 'serial' });
  let token = '';

  test.describe('nested', () => {
    let nestedId = '';
    test('creates', async ({ page }) => {
      await page.goto('https://example.com/new');
      token = await page.getByTestId('token').innerText();
      nestedId = token + '1';
    });
    test('uses', async ({ page }) => {
      await page.goto(`https://example.com/items/${token}/${nestedId}`);
      await expect(page.getByTestId('title')).toBeVisible();
    });
  });
});
