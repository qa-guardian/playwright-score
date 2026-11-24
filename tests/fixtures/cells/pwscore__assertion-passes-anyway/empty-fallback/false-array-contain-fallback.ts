import { test, expect } from '@playwright/test';

test('list holds the chosen name', async ({ page }) => {
  await page.goto('/teams');
  const chosen = await page.getByTestId('chosen-team').textContent();
  const names = await page.getByRole('option').allTextContents();
  expect(names).toContain(chosen ?? '');
});
