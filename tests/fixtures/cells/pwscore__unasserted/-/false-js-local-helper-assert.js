const { test, expect } = require('@playwright/test');

const expectToast = async (page, message) => {
  await expect(page.getByRole('alert')).toHaveText(message);
};

test('saves the note', async ({ page }) => {
  await page.goto('/notes/new');
  await page.getByRole('button', { name: 'Save' }).click();
  await expectToast(page, 'Note saved');
});
