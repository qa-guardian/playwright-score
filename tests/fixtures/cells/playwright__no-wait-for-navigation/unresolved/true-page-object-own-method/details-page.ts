import { expect, type Page } from '@playwright/test';

export class DetailsPage {
  constructor(private readonly page: Page) {}
  async waitForNavigation() {
    await expect(this.page).toHaveURL(/details/);
  }
}
