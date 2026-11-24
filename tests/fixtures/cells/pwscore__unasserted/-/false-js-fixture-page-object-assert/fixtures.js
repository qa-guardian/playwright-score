const { test: base } = require('@playwright/test');
const { InboxPage } = require('./inbox-page');

const test = base.extend({
  inbox: async ({ page }, use) => {
    await use(new InboxPage(page));
  },
});

module.exports = { test };
