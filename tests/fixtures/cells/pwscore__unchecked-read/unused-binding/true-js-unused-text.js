import { test, expect } from '@playwright/test';

test('shows the welcome heading', async ({ page }) => {
  await page.goto('/welcome');
  const heading = await page.getByRole('heading', { level: 1 }).textContent();
  await page.getByRole('button', { name: 'Get started' }).click();
});
