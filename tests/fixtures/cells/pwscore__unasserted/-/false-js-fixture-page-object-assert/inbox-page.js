const { expect } = require('@playwright/test');

class InboxPage {
  constructor(page) {
    this.page = page;
  }

  async open() {
    await this.page.goto('/inbox');
  }

  async archiveFirst() {
    await this.page.getByRole('listitem').first().getByRole('button', { name: 'Archive' }).click();
  }

  async expectEmpty() {
    await expect(this.page.getByText('No messages')).toBeVisible();
  }
}

module.exports = { InboxPage };
