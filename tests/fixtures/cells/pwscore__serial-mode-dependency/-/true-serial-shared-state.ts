import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

let ticketRef = '';

test('files the ticket', async ({ page }) => {
  await page.goto('/support/new');
  ticketRef = 'T-42';
  await expect(page.getByRole('heading', { name: 'New ticket' })).toBeVisible();
});

test('views the ticket', async ({ page }) => {
  await page.goto('/support/tickets/' + ticketRef);
  await expect(page.getByRole('heading', { name: 'Ticket' })).toBeVisible();
});
