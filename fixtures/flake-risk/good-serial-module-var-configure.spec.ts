import { test, expect } from '@playwright/test';

let bookingId = '';

test.describe('booking', () => {
  test.describe.configure({ mode: 'serial' });
  test('creates', async ({ page }) => {
    await page.goto('https://example.com/new');
    bookingId = await page.getByTestId('id').innerText();
  });
  test('reads', async ({ page }) => {
    await page.goto(`https://example.com/b/${bookingId}`);
    await expect(page.getByTestId('title')).toBeVisible();
  });
});
