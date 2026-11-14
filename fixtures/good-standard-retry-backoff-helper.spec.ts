import { test, expect } from '@playwright/test';

// Fixture: a retry loop with a backoff pause inside a plain helper that
// polls an API. It paces requests to a service; it is not a test sleeping
// on the UI.
async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
  let last: Response | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      last = await fetch(url);
      if (last.ok) return last;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500 * (i + 1)));
    }
  }
  return last as Response;
}

test('api is healthy', async ({ page }) => {
  const res = await fetchWithRetry('http://localhost:3000/health');
  expect(res.ok).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
});
