import { test, expect } from '@playwright/test';

test('orders page', async ({ page }) => {
  await page.goto('/orders');
  const heading = await page.getByRole('heading').textContent();
  if (heading) {
    await page.getByRole('link', { name: heading }).click();
  }
  expect(heading).toBe('Orders');
});
