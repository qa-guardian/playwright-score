import { expect, test } from 'vitest';

// A component test in the same folder: the DOM matcher of this library is synchronous.
test('banner is shown', () => {
  const banner = document.querySelector('#banner');
  expect(banner).toBeVisible();
});
