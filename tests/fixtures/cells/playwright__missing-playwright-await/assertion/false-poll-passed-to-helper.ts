import { test, expect } from '@playwright/test';

async function whenDone(work: Promise<void>): Promise<void> {
  await work;
}

test('health endpoint', async ({ page }) => {
  await page.goto('/');
  await whenDone(expect.poll(async () => (await page.request.get('/api/health')).status()).toBe(200));
});
