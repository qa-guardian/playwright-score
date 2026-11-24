const { test } = require('./fixtures');

test('archives a message', async ({ inbox }) => {
  await inbox.open();
  await inbox.archiveFirst();
  await inbox.expectEmpty();
});
