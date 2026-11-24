import { test, expect, type Page } from '@playwright/test';

test('redeclared', async ({ browser }) => {
  var page: Page = await browser.newPage();
  if (process.env.LEGACY) {
    var page: Page = (await browser.contexts()[0].pages())[0];
  }
  await page.waitForSelector('#ready');
  await expect(page.getByRole('heading')).toBeVisible();
});
