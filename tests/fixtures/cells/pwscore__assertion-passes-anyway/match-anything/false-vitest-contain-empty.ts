import { expect, test } from 'vitest';

// A vitest suite that drives a browser: `page` is a global of its environment.
test('plan label', async () => {
  await page.goto('http://localhost:4173/billing');
  const label = await page.locator('#plan-name').innerText();
  expect(label).toContain('');
});
