import { test, expect } from '@playwright/test';

const check = expect;

test('signup form', async ({ page }) => {
  await page.goto('/signup');
  const field = await page.$('#email');
  check(await field!.inputValue()).toBe('');
});
