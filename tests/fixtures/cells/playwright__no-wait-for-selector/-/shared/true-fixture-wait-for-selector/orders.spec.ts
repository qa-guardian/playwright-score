import { test, expect } from './true-fixtures';

test('orders page', async ({ ordersPanel }) => {
  await expect(ordersPanel.getByRole('heading', { name: 'Orders' })).toBeVisible();
});
