/** @param {import('@playwright/test').Page} page */
export async function refreshOrders(page) {
  await page.waitForSelector('#orders');
}
