import { test, expect } from '@playwright/test';

test.describe('Blog post', () => {
  test('shows author name and respects a session timeout field', async ({ page }) => {
    const authorName = 'Jane Smith';
    const sessionConfig = { timeout: 1800, retries: 3 };

    await test.step('Render post', async () => {
      await page.goto('/post');
      await expect(page.getByText(authorName)).toBeVisible();
      await expect(page.getByText(String(sessionConfig.timeout))).toBeVisible();
    });
  });
});
