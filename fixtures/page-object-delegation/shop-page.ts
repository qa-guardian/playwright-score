import { expect, type Page } from '@playwright/test';

export class ShopPage {
  constructor(private readonly page: Page) {}

  async openHome() {
    await this.page.goto('/');
  }

  async expectLoaded() {
    await expect(this.page.getByRole('heading', { name: 'Shop' })).toBeVisible();
  }
}
