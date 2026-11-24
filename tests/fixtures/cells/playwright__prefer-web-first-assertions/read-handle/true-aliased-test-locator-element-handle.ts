import { test, expect } from '@playwright/test';

const it = test;

it('invoice total', async ({ page }) => {
  await page.goto('/invoices');
  const handle = await page.getByTestId('invoice-total').elementHandle();
  expect(await handle!.textContent()).toBe('$120.00');
});
