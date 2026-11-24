import { test, expect } from '@playwright/test';

test('every badge is labelled', async ({ page }) => {
  const screen = page;
  await screen.goto('/profile/badges');
  for (let i = 0; i < await screen.getByTestId('badge').count(); i++) {
    await expect(screen.getByTestId('badge').nth(i)).toHaveAttribute('aria-label', /badge/);
  }
});
