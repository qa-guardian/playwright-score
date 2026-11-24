import { open } from './browsers';

(async () => {
  const browser = await open(process.env.LEGACY);
  const tabPage = await browser.newPage();
  await tabPage.waitForNavigation();
})();
