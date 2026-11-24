import { test, expect, type Page } from '@playwright/test';

async function cartTotal(page: Page) {
  const total = await page.getByTestId('cart-total').innerText();
  return total;
}

test('total includes tax', async ({ page }) => {
  await page.goto('/cart');
  expect(await cartTotal(page)).toContain('incl. tax');
});
