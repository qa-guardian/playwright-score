import { test, expect } from '@playwright/test';

const it = test;

it('ticket total', async ({ page }) => {
  await page.goto('/board');
  const counter = page.getByTestId('ticket-total');
  const before = await counter.textContent();
  await page.getByRole('button', { name: 'Add ticket' }).click();
  expect(await counter.textContent()).not.toEqual(before);
});
