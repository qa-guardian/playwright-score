import { test, expect } from '@playwright/test';

test('one tag is blank', async ({ page }) => {
  await page.goto('/articles/7');
  const tags = await page.getByRole('listitem').allTextContents();
  expect(tags).toContain('');
});
