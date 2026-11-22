import type { Page } from '@playwright/test';

export class CartPage {
  constructor(private readonly page: Page) {}
  get checkoutButton() {
    return this.page.locator('#checkout');
  }
  row(n: number) {
    return this.page.getByRole('row').nth(n);
  }
  panel = () => this.page.getByRole('region');
  async open(options: { waitUntil?: 'load' | 'networkidle' } = {}) {
    await this.page.goto('/cart', options);
  }
  async press(options: { force?: boolean } = {}) {
    await this.page.getByRole('button', { name: 'Pay' }).click(options);
  }
}
