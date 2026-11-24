const { test } = require('@playwright/test');

test('the build is passing', async ({ page }) => {
  await page.goto('/status');
  const state = await page.getByTestId('build-state').textContent();
  if (state !== 'passing') throw new Error(`unexpected build state: ${state}`);
});
