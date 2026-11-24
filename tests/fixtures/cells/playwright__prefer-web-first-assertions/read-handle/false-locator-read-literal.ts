import { test, expect } from '@playwright/test';

test('signup form', async ({ page }) => {
  await page.goto('/signup');
  expect(await page.getByLabel('Email').inputValue()).toBe('');
});
