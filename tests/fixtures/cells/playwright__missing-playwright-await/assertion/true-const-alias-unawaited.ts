import { test, expect } from '@playwright/test';

const check = expect;

test('order confirmation shows the total', async ({ page }) => {
  await page.goto('/orders/latest');
  check(page.getByTestId('order-total')).toHaveText('$42.00');
});
