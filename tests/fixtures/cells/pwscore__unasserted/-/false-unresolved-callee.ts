import { test } from '@playwright/test';

test('lists the seeded orders', async ({ page, seedOrders }) => {
  // No fixture table in reach declares seedOrders: what it does is not known.
  await seedOrders(3);
  await page.goto('/orders');
});
