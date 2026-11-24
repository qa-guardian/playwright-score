import { test, expect } from '@playwright/test';

test('promo banner shows the sale', async ({ page }) => {
  await page.goto('/shop');
  const banner = page.getByTestId('promo-banner');
  const problems: unknown[] = [];
  await expect(banner).not.toBeVisible().catch((error) => {
    problems.push(error);
  });
  await page.getByRole('button', { name: 'Show offers' }).click();
  await expect(banner).toHaveText('Winter sale');
  expect(problems).toEqual([]);
});
