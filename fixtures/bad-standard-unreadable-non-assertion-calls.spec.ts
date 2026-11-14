import { test } from '@acme/e2e-lib';
import { helpers } from '@acme/qa-utils';

// Fixture: calls on objects this scan cannot read, but none of the method
// names reads like an assertion (waitForLoad, waitForNetworkIdle, list), so
// nothing says an assertion could be hiding there. Each test is an
// expect-expect error, not a "needs a human check".
test('fixture call only', async ({ page, app }) => {
  await app.waitForLoad();
  await page.click('#go');
});

test('library wait', async ({ page }) => {
  await page.goto('/');
  await helpers.waitForNetworkIdle(page);
});

test('data fixture loop', async ({ page, users }) => {
  for (const u of users.list()) {
    await page.fill('#u', u);
  }
});
