import { test, expect } from '@playwright/test';

test('signup form', async ({ page }) => {
  await page.goto('/signup');
  const field = await page.$('#email');
  const prior = await page.getByLabel('Backup email').inputValue();
  expect(await field!.inputValue()).toBe(prior);
});
