import { test, expect } from '@playwright/test';

async function track(check: unknown): Promise<void> {
  await check;
}

test('status', async ({ page }) => {
  await page.goto('/');
  track(expect(page.getByRole('status')).toHaveText('Ready'));
});
