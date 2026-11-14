import { test, expect } from '@playwright/test';

// Fixture: an inner array is mutated through an index access, so the
// asserted outer array is not a constant.
test('push on an inner array', async () => {
  const rows = [[1], [2]];
  rows[0].push(9);
  expect(rows).toEqual([[1, 9], [2]]);
});
test('write into an inner array', async () => {
  const grid = [[1], [2]];
  grid[1][0] = 5;
  expect(grid).toEqual([[1], [5]]);
});
