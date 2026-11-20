import { test, expect } from '@playwright/test';

test('orders rows', async ({ page }) => {
  await page.goto('/orders');
  const rows = page.getByRole('row');
  const n = await rows.count();
  console.log(n);
  [1, 2].forEach((n) => expect(n).toBe(1));
});
