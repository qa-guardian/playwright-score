import { test, expect } from '@playwright/test';
import puppeteer from 'puppeteer';

test('every tab', async ({ context }) => {
  const legacy = await puppeteer.launch();
  const page = await legacy.newPage();
  for (const page of context.pages()) {
    await page.waitForSelector('#ready');
  }
  const tabs: Record<string, any> = { first: context.pages()[0] };
  for (const page in tabs) {
    await tabs[page].waitForSelector('#ready');
  }
  try {
    await expect(context.pages()[0]).toHaveURL(/ready/);
  } catch (page: any) {
    await page.waitForSelector('#ready');
  }
  await page.close();
});
