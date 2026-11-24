import { test, expect } from '@playwright/test';

test('comment editor starts empty', async ({ page }) => {
  await page.goto('/posts/12');
  await expect(page.getByRole('textbox', { name: 'Comment' })).toHaveText('');
});
