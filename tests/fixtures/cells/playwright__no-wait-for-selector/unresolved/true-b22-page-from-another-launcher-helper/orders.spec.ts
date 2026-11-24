import { launch } from './legacy-browser';

(async () => {
  const browser = await launch();
  const tabPage = await browser.newPage();
  await tabPage.waitForSelector('#orders-table');
})();
