import { test, expect } from '@playwright/test';

test('signup form', async ({ page }) => {
  await page.goto('/signup');
  const field = await page.$('#email');
  expect(await field!.inputValue()).toBe('');
});
