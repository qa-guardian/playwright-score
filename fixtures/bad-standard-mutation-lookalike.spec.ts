import { test, expect } from '@playwright/test';

// Fixture: the array is only ever read (a .length read, an unrelated
// property that happens to share the name), so each expect is constant.
test('length read is not a mutation', async () => {
  const expected = [1, 2];
  expect(expected).toEqual([1, 2]);
  console.log(expected.length);
});

test('same-named property is not a reference', async () => {
  const items = [1, 2];
  const box = { items: 3 };
  expect(items).toEqual([1, 2]);
  expect(box.items).toBe(3);
});
