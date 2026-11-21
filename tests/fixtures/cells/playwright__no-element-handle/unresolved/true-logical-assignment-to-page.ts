import { test, expect } from '@playwright/test';
import puppeteer from 'puppeteer';

test('reassigned', async ({ page: fixturePage }) => {
  const legacy = await puppeteer.launch();
  let page: any = await legacy.newPage();
  page ??= fixturePage;
  page ||= fixturePage;
  page &&= fixturePage;
  const title = await page.$('h1');
  expect(title).not.toBeNull();
});
