import { type Page } from '@playwright/test';

export class CheckoutPage {
  constructor(private readonly page: Page) {}

  async open() {
    await this.page.goto('/checkout');
  }

  async payWithSavedCard() {
    await this.page.getByRole('button', { name: 'Pay with saved card' }).click();
  }
}
