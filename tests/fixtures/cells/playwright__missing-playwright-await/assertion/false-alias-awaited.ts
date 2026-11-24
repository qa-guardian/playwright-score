import { test, expect } from '@playwright/test';

const check = expect;

test('search returns results', async ({ page }) => {
  await page.goto('/search?q=lamp');
  await check(page.getByRole('listitem')).toHaveCount(3);
});
