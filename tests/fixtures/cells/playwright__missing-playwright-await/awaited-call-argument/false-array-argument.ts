import { test, expect } from '@playwright/test';

async function track(check: unknown): Promise<void> {
  await check;
}

test('navigation', async ({ page }) => {
  await page.goto('/');
  await track([expect(page.getByRole('navigation')).toBeVisible()]);
});
