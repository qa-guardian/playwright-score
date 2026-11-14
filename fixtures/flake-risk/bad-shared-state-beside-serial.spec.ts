import { test, expect } from '@playwright/test';

test.describe.serial('ordered', () => {
  let ok = '';
  test('a', async () => {
    ok = 'x';
  });
  test('b', async () => {
    expect(ok).toBe('x');
  });
});

test.describe('unordered', () => {
  let id = '';
  test('creates', async ({ page }) => {
    await page.goto('https://example.com/new');
    id = await page.getByTestId('id').innerText();
  });
  test('uses', async ({ page }) => {
    await page.goto(`https://example.com/items/${id}`);
    await expect(page.getByTestId('title')).toBeVisible();
  });
});
