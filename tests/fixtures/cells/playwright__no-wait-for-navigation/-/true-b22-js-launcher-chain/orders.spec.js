const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const tabPage = await browser.newPage();
  await tabPage.waitForNavigation();
  await browser.close();
})();
