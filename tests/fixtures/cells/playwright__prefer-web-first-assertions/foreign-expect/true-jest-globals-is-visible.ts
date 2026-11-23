import { expect, test } from '@jest/globals';

// A jest suite that drives a browser: `page` is a global of its environment.
test('invoice table is shown', async () => {
  await page.goto('http://localhost:4173/invoices');
  expect(await page.isVisible('#invoice-table')).toBe(true);
});
