import { test, expect } from '@playwright/test';

test('confirms the save', async ({ page }) => {
  await page.goto('/form');
  await expect(page.getByTestId('status')).toHaveText('Saved');
});

test('links to the invoice', async ({ page }) => {
  await page.goto('/form');
  await expect(page.getByRole('link', { name: 'Invoice' })).toHaveAttribute('href', '/invoices/1');
});

test('matches a pattern', async ({ page }) => {
  await page.goto('/form');
  await expect(page.getByTestId('status')).toHaveText(/^Saved/);
});

test('names the user', async ({ page }) => {
  await page.goto('/form');
  await expect(page.getByTestId('user')).toHaveText(`Ada`);
});
