import { test } from './fixtures';

// Overridden `page` fixture asserts in setup only: this test has no assertion.
test('deletes without checking', async ({ page }) => {
  await page.click('#delete');
});

// Destructures a setup-asserting fixture but never calls it.
test('uses loggedIn but never calls it', async ({ page, loggedIn }) => {
  await page.click('#delete');
});
