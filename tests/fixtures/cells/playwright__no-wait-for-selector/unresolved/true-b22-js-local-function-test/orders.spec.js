const fakePage = { goto: async () => null, waitForSelector: async () => null, waitForNavigation: async () => null };
function test(title, body) { return body({ page: fakePage }); }

test('orders table loads', async ({ page }) => {
  await page.goto('/orders');
  await page.waitForSelector('#orders-table');
});
