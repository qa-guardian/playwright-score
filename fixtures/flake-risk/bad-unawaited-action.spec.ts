import { test, expect } from '@playwright/test';

test('forgets to await actions', async ({ page }) => {
  page.goto('https://example.com/login');
  page.getByRole('button', { name: 'Sign in' }).click();
  const field = page.getByLabel('Email');
  field.fill('a@example.com');
  await expect(page.getByText('Welcome')).toBeVisible();
});
