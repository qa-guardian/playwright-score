import { test, expect } from '@playwright/test';

let id = '';

test('create | the record\nsecond line', async ({ page }) => {
  await page.goto('https://example.com/new');
  id = await page.getByTestId('id').innerText();
});

test('uses it', async ({ page }) => {
  await page.goto(`https://example.com/items/${id}`);
  await expect(page.getByTestId('title')).toBeVisible();
});
