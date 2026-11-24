import { test, expect } from '@playwright/test';

const lookup = { $: (key: string) => `cached-${key}` };

test('first invoice', async ({ page }) => {
  const p = page;
  await p.goto('/invoices');
  await p.waitForSelector('#invoice-table');
  const read = (p: typeof lookup) => p.$('invoice-1001');
  expect(read(lookup)).toBe('cached-invoice-1001');
});
