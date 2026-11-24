import { expect, test } from '@jest/globals';

// A jest suite that drives a browser: `page` is a global of its environment.
test('next cover', async () => {
  await page.goto('http://localhost:4173/gallery');
  const prior = await page.getAttribute('#cover', 'src');
  await page.click('#next');
  expect(await page.getAttribute('#cover', 'src')).not.toBe(prior);
});
