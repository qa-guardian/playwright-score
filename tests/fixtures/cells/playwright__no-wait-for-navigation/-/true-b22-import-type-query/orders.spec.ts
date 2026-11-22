
export async function open(targetPage: import('playwright').Page) {
  await targetPage.waitForNavigation();
}
