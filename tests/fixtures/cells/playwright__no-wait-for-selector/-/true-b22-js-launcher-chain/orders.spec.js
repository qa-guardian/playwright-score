const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const tabPage = await browser.newPage();
  await tabPage.waitForSelector('#orders-table');
  await browser.close();
})();
