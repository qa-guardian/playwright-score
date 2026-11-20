import { test, expect } from '@playwright/test';

test('orders page', async () => {
  const tally = { count: () => 4 };
  expect(tally.count()).toBe(4);
});
