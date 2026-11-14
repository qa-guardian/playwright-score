import { test, expect } from '@playwright/test';

// Fixture: only index reads, no mutation: the expect is constant.
test('index read is not a mutation', async () => {
  const rows = [[1], [2]];
  console.log(rows[0].length, rows[1].map((x) => x + 1));
  expect(rows).toEqual([[1], [2]]);
});
