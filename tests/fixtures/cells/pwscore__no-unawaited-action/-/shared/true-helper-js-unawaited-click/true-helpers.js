/** @param {import('@playwright/test').Page} page */
export async function refreshOrders(page) {
  page.getByRole('button', { name: 'Refresh' }).click();
}
