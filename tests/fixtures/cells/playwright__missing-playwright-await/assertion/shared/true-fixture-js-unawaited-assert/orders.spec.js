import { test, expect } from './true-fixtures.js';

test('orders page', async ({ ordersPanel }) => {
  await expect(ordersPanel.getByRole('heading', { name: 'Orders' })).toBeVisible();
});
