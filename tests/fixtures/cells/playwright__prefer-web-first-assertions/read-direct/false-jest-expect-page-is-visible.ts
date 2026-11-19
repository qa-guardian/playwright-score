import { expect, test } from '@jest/globals';

// jest-playwright style: `page` is a global and there is no web-first matcher to use.
test('cart page', async () => {
  await page.goto('http://localhost:3000/cart');
  expect(await page.isVisible('#cart')).toBe(true);
});
