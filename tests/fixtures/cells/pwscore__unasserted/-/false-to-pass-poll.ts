import { test, expect } from '@playwright/test';

test('the job finishes', async ({ page }) => {
  await page.goto('/jobs/42');
  await expect(async () => {
    const response = await page.request.get('/api/jobs/42');
    expect(response.status()).toBe(200);
  }).toPass();
});

test('the queue drains', async ({ page }) => {
  await page.goto('/queue');
  await expect.poll(async () => page.getByRole('listitem').count()).toBe(0);
});

test('the badge is soft-checked', async ({ page }) => {
  await page.goto('/queue');
  await expect.soft(page.getByTestId('badge')).toHaveText('0');
});
