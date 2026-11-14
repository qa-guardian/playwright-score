import { test, expect } from '@playwright/test';

let setupId = '';
let counter = 0;
const log: string[] = [];

test.beforeEach(async () => {
  counter = 0;
  setupId = 'seed';
});

test('reads setup state', async ({ page }) => {
  counter++;
  log.push('a');
  await page.goto(`https://example.com/items/${setupId}`);
  await expect(page.getByTestId('title')).toBeVisible();
  expect(counter).toBe(1);
});

test('reads setup state again', async ({ page }) => {
  await page.goto(`https://example.com/items/${setupId}`);
  await expect(page.getByTestId('title')).toBeVisible();
});

test('writes before reading its own state', async ({ page }) => {
  let local = '';
  local = await page.getByTestId('id').innerText();
  expect(local).not.toBe('');
});
