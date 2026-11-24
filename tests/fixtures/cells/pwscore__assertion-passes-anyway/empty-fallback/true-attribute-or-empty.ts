import { test, expect } from '@playwright/test';

test('link leads to its target', async ({ page }) => {
  await page.goto('/help');
  const link = page.getByRole('link', { name: 'Contact support' });
  const href = await link.getAttribute('href');
  await link.click();
  expect(page.url()).toContain(href || '');
});
