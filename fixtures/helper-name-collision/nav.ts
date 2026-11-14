import { expect, type Page } from '@playwright/test';

export const nav = {
  goto: async (page: Page, url: string) => {
    await page.goto(url);
    await expect(page).toHaveURL(url);
  },
};

export class Forms {
  async fill(page: Page) {
    await page.fill('#a', 'b');
    await expect(page.locator('#a')).toHaveValue('b');
  }
}
