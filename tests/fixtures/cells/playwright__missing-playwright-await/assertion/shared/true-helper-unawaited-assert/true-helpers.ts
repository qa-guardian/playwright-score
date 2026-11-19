import { test, expect, type Page } from '@playwright/test';

export async function checkHeading(page: Page) {
  expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible();
}
