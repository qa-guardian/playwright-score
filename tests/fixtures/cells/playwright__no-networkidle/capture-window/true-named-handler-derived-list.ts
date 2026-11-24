import { test, expect } from '@playwright/test';

test('report analytics', async ({ page }) => {
  const requests: string[] = [];
  const onRequest = (request: { url(): string }) => {
    requests.push(request.url());
  };
  page.on('request', onRequest);
  await page.goto('/reports', { waitUntil: 'networkidle' });
  const tracked = requests.filter((url) => url.includes('/analytics'));
  expect(tracked).toHaveLength(1);
});
