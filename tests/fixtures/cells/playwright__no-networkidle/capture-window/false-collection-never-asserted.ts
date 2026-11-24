import { test, expect } from '@playwright/test';

test('dashboard', async ({ page }) => {
  const statuses: number[] = [];
  page.on('response', (response) => statuses.push(response.status()));
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});
