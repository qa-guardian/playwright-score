import { test, expect } from '@playwright/test';

test('menu opens', async ({ page }) => {
  await page.goto('/menu');
  await page.getByRole('button', { name: 'Open' }).click();
  void expect(page.getByRole('menu')).toBeVisible();
});
