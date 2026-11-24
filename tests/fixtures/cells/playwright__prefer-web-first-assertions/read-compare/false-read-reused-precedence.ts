import { test, expect } from '@playwright/test';

test('ticket total', async ({ page }) => {
  await page.goto('/board');
  const before = await page.getByTestId('ticket-total').textContent();
  await page.getByRole('button', { name: 'Add ticket' }).click();
  const after = await page.getByTestId('ticket-total').textContent();
  console.log(after);
  expect(after).not.toBe(before);
});
