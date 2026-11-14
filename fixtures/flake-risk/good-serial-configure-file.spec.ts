import { test, expect } from '@playwright/test';

let createdId = '';

test.describe.configure({ mode: 'serial' });

test('creates a record', async ({ page }) => {
  await page.goto('https://example.com/new');
  createdId = await page.getByTestId('id').innerText();
});

test('uses the record from the previous test', async ({ page }) => {
  await page.goto(`https://example.com/items/${createdId}`);
  await expect(page.getByTestId('title')).toBeVisible();
});
