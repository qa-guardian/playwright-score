const { test } = require('./fixtures');

test('invoice', async ({ page }) => {
  const total = await page.$('#total');
  if (!total) throw new Error('no total');
});
