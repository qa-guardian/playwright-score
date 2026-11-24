/** @param {import('@playwright/test').Page} page */
export async function refreshOrders(page) {
  page.waitForResponse('**/api/orders');
}
