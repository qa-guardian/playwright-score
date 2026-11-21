import { test, expect } from '@playwright/test';
import puppeteer from 'puppeteer';

test('reassigned', async ({ browser: pw }) => {
  const legacy = await puppeteer.launch();
  let page: any = await legacy.newPage();
  ({ page } = { page: await pw.newPage() });
  const title = await page.$('h1');
  expect(title).not.toBeNull();
});
