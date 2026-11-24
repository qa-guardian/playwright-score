import { test, expect } from '@playwright/test';

test('order status', async ({ page, request }) => {
  await page.goto('/orders');
  const ids = ['1001', '1002'];
  ids.forEach(async (id) => {
    await expect.poll(async () => (await request.get(`/api/orders/${id}`)).status()).toBe(200);
  });
});
