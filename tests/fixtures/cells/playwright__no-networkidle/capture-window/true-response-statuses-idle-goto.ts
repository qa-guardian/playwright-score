import { test, expect } from '@playwright/test';

test('dashboard requests', async ({ page }) => {
  const statuses: number[] = [];
  page.on('response', (response) => statuses.push(response.status()));
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  expect(statuses.every((status) => status < 400)).toBe(true);
});
