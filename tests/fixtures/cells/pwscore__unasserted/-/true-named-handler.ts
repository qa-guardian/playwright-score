import { test } from '@playwright/test';

async function opensOrders({ page }) {
  await page.goto('/orders');
  await page.getByRole('link', { name: 'Newest first' }).click();
}

test('opens the orders page', opensOrders);
