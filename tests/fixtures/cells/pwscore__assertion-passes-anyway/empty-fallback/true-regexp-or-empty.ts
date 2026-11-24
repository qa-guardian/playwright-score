import { test, expect } from '@playwright/test';

test('results mention the hint', async ({ page }) => {
  await page.goto('/search');
  const term = await page.getByRole('searchbox').getAttribute('placeholder');
  const results = await page.getByRole('region', { name: 'Results' }).innerText();
  expect(results).toMatch(new RegExp(term || ''));
});
