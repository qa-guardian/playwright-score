import { test, expect } from '@playwright/test';

test('confirms the save', async ({ page }) => {
  await page.goto('/form');
  await expect(page.getByTestId('status')).toHaveText('Save');
});

test('links to the invoice', async ({ page }) => {
  await page.goto('/form');
  await expect(page.getByRole('link', { name: 'Invoice' })).toHaveAttribute('href', '/invoices/2');
});

// A pattern changed: not a plain literal, so not reported.
test('matches a pattern', async ({ page }) => {
  await page.goto('/form');
  await expect(page.getByTestId('status')).toHaveText(/^Sav/);
});

// Same text, other quote style and layout: nothing changed.
test('names the user', async ({ page }) => {
  await page.goto('/form');
  await expect(
    page.getByTestId('user')
  ).toHaveText("Ada");
});
