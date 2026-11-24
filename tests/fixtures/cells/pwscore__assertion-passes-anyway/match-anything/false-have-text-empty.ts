import { test, expect } from '@playwright/test';

test('note starts empty', async ({ page }) => {
  await page.goto('/notes/new');
  await expect(page.getByTestId('note-preview')).toHaveText('');
});
