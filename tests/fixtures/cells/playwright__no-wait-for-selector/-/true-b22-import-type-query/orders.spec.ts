
export async function open(targetPage: import('playwright').Page) {
  await targetPage.waitForSelector('#orders-table');
}
