const { test, expect } = require('@playwright/test');

const check = expect;

test('ticket total', async ({ page }) => {
  await page.goto('/board');
  const counter = page.getByTestId('ticket-total');
  const before = await counter.textContent();
  await page.getByRole('button', { name: 'Add ticket' }).click();
  check(await counter.textContent()).not.toEqual(before);
});
