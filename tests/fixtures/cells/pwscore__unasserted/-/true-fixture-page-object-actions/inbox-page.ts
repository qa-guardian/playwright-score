import { type Page } from '@playwright/test';

export class InboxPage {
  constructor(private readonly page: Page) {}

  async open() {
    await this.page.goto('/inbox');
  }

  async archiveFirst() {
    await this.page.getByRole('listitem').first().getByRole('button', { name: 'Archive' }).click();
  }
}
