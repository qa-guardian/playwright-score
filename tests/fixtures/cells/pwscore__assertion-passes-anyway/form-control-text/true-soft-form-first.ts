import { test, expect } from '@playwright/test';

test('signup form keeps no stale code', async ({ page }) => {
  await page.goto('/signup');
  const form = page.getByRole('form', { name: 'Sign up' });
  await expect.soft(form.locator('input[type="number"].code').first()).not.toContainText('4321');
});
