import { test, expect } from '@playwright/test';

test('reload data', async ({ page }) => {
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  const statuses: number[] = [];
  page.on('response', (response) => statuses.push(response.status()));
  await page.getByRole('button', { name: 'Reload data' }).click();
  await expect(page.getByRole('status')).toHaveText('Up to date');
  expect(statuses).not.toContain(500);
});
