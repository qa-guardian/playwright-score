import puppeteer from 'puppeteer';
import { chromium } from 'playwright-chromium';

export const legacy = puppeteer;
export async function launchAny() {
  return chromium.launch();
}
