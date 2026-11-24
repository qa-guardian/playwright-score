import { test } from '@playwright/test';

test('exports the report', async ({ page, browserName }) => {
  // A conditional skip does not exclude the test.
  test.skip(browserName === 'webkit', 'Export is not available on WebKit');
  await page.goto('/reports');
  await page.getByRole('button', { name: 'Export' }).click();
});
