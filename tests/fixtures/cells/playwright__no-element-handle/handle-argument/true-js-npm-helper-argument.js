const { test, expect } = require('@playwright/test');
const { analyzeNode } = require('dom-node-report');

test('order summary is analyzed', async ({ page }) => {
  await page.goto('/checkout');
  const handle = await page.$('#order-summary');
  const opts = { depth: 2 };
  await analyzeNode(handle, opts);
  await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled();
});
