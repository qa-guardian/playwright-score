import puppeteer from 'puppeteer';

export async function launchLegacyBrowser() {
  return puppeteer.launch({ headless: true });
}
