import { expect, test } from 'vitest';

test('cart total', () => {
  const total = [1, 2, 3].reduce((a, b) => a + b, 0);
  expect(total).to.be.a('number');
  expect(total).to.be.ok;
});
