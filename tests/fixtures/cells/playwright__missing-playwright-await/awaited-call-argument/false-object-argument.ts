import { test, expect } from '@playwright/test';

async function track(check: unknown): Promise<void> {
  await check;
}

test('footer', async ({ page }) => {
  await page.goto('/');
  await track({ check: expect(page.getByRole('contentinfo')).toBeVisible() });
});
