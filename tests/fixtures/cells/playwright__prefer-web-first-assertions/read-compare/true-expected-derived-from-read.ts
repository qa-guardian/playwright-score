import { test, expect } from '@playwright/test';

test('note status', async ({ page }) => {
  await page.goto('/notes');
  const draft = await page.getByLabel('Note').inputValue();
  const expected = `${draft} (saved)`;
  await page.getByRole('button', { name: 'Save' }).click();
  expect(await page.getByTestId('note-status').innerText()).toBe(expected);
});
