import { test as base } from '@playwright/test';
import { InboxPage } from './inbox-page';

export const test = base.extend<{ inbox: InboxPage }>({
  inbox: async ({ page }, use) => {
    await use(new InboxPage(page));
  },
});
