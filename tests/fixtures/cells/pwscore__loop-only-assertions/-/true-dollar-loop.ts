import { test, expect } from '@playwright/test';

test('every search hit names a plan', async ({ page }) => {
  await page.goto('/search?q=plan');
  for (const hit of await page.$$('.search-hit')) {
    expect(await hit.textContent()).toContain('Plan');
  }
});
