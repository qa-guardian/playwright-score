import { test, expect } from '@playwright/test';

test('menu opens', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('navigation').isVisible();
});
