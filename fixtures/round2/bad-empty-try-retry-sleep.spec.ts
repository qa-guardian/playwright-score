import { test, expect } from '@playwright/test';

// Fixture: a loop around an EMPTY try block is not a retry shape, so the
// helper's sleep is still a hard-coded wait.
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    try {
      // nothing to retry
    } catch {
      /* unreachable */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

test('settles', async ({ page }) => {
  await settle();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
});
