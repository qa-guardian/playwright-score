const { test } = require('./fixtures');

test('ledger', async ({ page }) => {
  await page.waitForSelector('#ledger');
});
