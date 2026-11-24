class CheckoutPage {
  constructor(page) {
    this.page = page;
  }

  async open() {
    await this.page.goto('/checkout');
  }

  async payWithSavedCard() {
    await this.page.getByRole('button', { name: 'Pay with saved card' }).click();
  }
}

module.exports = { CheckoutPage };
