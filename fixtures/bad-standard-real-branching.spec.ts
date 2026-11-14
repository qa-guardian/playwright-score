import { test, expect } from '@playwright/test';

// Fixture: real branching. The throw guard must not hide these.
test('guard with an else branch', async ({ page }) => {
  await page.goto('/');
  const id = await page.getByTestId('id').textContent();
  if (!id) {
    throw new Error('no id');
  } else {
    await page.getByRole('button', { name: 'Go' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
});

test('branch that does work', async ({ page }) => {
  await page.goto('/');
  if (await page.getByRole('dialog').isVisible()) {
    await page.getByRole('button', { name: 'Close' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
});
