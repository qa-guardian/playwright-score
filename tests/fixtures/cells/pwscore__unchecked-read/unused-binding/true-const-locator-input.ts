import { test, expect } from '@playwright/test';

test('keeps the typed email', async ({ page }) => {
  await page.goto('/signup');
  const email = page.getByLabel('Email');
  await email.fill('ana@example.com');
  const typed = await email.inputValue();
  await page.getByRole('button', { name: 'Continue' }).click();
});
