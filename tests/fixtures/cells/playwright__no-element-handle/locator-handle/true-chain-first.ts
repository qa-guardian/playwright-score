import { test, expect } from '@playwright/test';

test('first order row', async ({ page }) => {
  await page.goto('/orders');
  const handle = await page.getByRole('row').first().elementHandle();
  await handle?.hover();
  await expect(page.getByRole('row').first()).toBeVisible();
});
