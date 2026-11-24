import * as pw from 'playwright';

export async function open(targetPage: pw.Page) {
  await targetPage.waitForNavigation();
}
