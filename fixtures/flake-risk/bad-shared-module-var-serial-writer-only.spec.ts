import { test, expect } from '@playwright/test';

let bookingId = '';

test.describe('ordered writer', () => {
  test.describe.configure({ mode: 'serial' });
  test('creates', async ({ page }) => {
    await page.goto('https://example.com/new');
    bookingId = await page.getByTestId('id').innerText();
  });
});

test.describe('unordered reader', () => {
  test('reads', async ({ page }) => {
    await page.goto(`https://example.com/b/${bookingId}`);
    await expect(page.getByTestId('title')).toBeVisible();
  });
});
